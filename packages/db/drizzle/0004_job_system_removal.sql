ALTER TABLE "webhook_delivery" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "webhook_delivery_pending_idx" ON "webhook_delivery" USING btree ("next_attempt_at","created_at") WHERE "webhook_delivery"."status" = 'pending';--> statement-breakpoint
DELETE FROM "job" WHERE "kind" = 'webhook.deliver';--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_request_id" uuid;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_request_force" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_run_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_priority" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_claimed_request_id" uuid;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_failed_generation" integer;--> statement-breakpoint
-- Adopt live legacy clip.encode work before removing those job kinds. A
-- pending twin is the newest desired request and therefore wins over a
-- running row; force and priority are merged across both rows.
WITH "live_media_jobs" AS (
	SELECT
		j."id",
		lower(j."payload" ->> 'clipId') AS "clip_id_text",
		j."payload" ->> 'trigger' AS "trigger",
		j."status",
		j."priority",
		j."run_at",
		j."attempt",
		j."created_at",
		j."updated_at"
	FROM "job" j
	WHERE j."kind" = 'clip.encode'
		AND j."status" IN ('pending', 'running')
		AND j."payload" ->> 'clipId' IS NOT NULL
),
"chosen_media_jobs" AS (
	SELECT DISTINCT ON (j."clip_id_text") j.*
	FROM "live_media_jobs" j
	ORDER BY
		j."clip_id_text",
		CASE WHEN j."status" = 'pending' THEN 0 ELSE 1 END,
		j."updated_at" DESC,
		j."id" DESC
),
"merged_media_jobs" AS (
	SELECT
		j."clip_id_text",
		coalesce(bool_or(j."trigger" = 'reencode'), false) AS "force",
		bool_or(j."status" = 'running') AS "has_running",
		min(j."priority") AS "priority",
		min(j."run_at") AS "run_at",
		min(j."created_at") AS "requested_at"
	FROM "live_media_jobs" j
	GROUP BY j."clip_id_text"
)
UPDATE "clip" c
SET
	"encode_request_id" = chosen."id",
	"encode_request_force" = merged."force",
	"encode_requested_at" = merged."requested_at",
	"encode_run_after" = CASE
		WHEN merged."has_running" THEN now()
		ELSE merged."run_at"
	END,
	"encode_priority" = merged."priority",
	"encode_claimed_request_id" = CASE
		WHEN chosen."status" = 'running' THEN chosen."id"
		ELSE NULL
	END,
	"encode_attempt" = CASE
		WHEN chosen."status" = 'running' THEN greatest(c."encode_attempt", chosen."attempt")
		ELSE 0
	END
FROM "chosen_media_jobs" chosen
JOIN "merged_media_jobs" merged
	ON merged."clip_id_text" = chosen."clip_id_text"
WHERE c."id"::text = chosen."clip_id_text";--> statement-breakpoint
-- Preserve terminal legacy media failures as clip-owned admin failures. The
-- first direct-worker generation is 1, so ready clips remain quarantined until
-- an operator retries/discards them or a later config generation re-arms them.
WITH "failed_media_jobs" AS (
	SELECT DISTINCT ON (lower(j."payload" ->> 'clipId'))
		lower(j."payload" ->> 'clipId') AS "clip_id_text",
		j."attempt",
		j."error"
	FROM "job" j
	WHERE j."kind" = 'clip.encode'
		AND j."status" = 'failed'
		AND j."payload" ->> 'clipId' IS NOT NULL
	ORDER BY
		lower(j."payload" ->> 'clipId'),
		j."finished_at" DESC NULLS LAST,
		j."updated_at" DESC,
		j."id" DESC
)
UPDATE "clip" c
SET
	"encode_failed_generation" = 1,
	"encode_attempt" = greatest(c."encode_attempt", failed."attempt"),
	"failure_reason" = coalesce(c."failure_reason", failed."error")
FROM "failed_media_jobs" failed
WHERE c."id"::text = failed."clip_id_text"
	AND c."encode_request_id" IS NULL
	AND c."status" IN ('ready', 'failed');--> statement-breakpoint
-- One server process owns media work. Any legacy process is stopped before
-- this migration, so its row leases can be recovered immediately.
UPDATE "clip"
SET
	"encode_run_id" = NULL,
	"encode_locked_at" = NULL,
	"encode_stage" = NULL,
	"encode_tier" = NULL,
	"encode_tier_index" = NULL,
	"encode_tier_count" = NULL
WHERE "encode_run_id" IS NOT NULL;--> statement-breakpoint
-- Heal processing clips whose old job row was absent or malformed.
UPDATE "clip"
SET
	"encode_request_id" = gen_random_uuid(),
	"encode_request_force" = false,
	"encode_requested_at" = now(),
	"encode_run_after" = now(),
	"encode_priority" = 10,
	"encode_claimed_request_id" = NULL,
	"encode_attempt" = 0
WHERE "status" = 'processing'
	AND "encode_request_id" IS NULL;--> statement-breakpoint
-- Preserve an in-flight operator force-all across the cutover. The direct
-- generation store consumes and deletes this marker during startup.
INSERT INTO "instance_setting" ("key", "value", "updated_at")
SELECT 'mediaEncodeForcePending', 'true'::jsonb, now()
WHERE EXISTS (
	SELECT 1
	FROM "job" j
	WHERE j."kind" = 'clip.renditions-sweep'
		AND j."status" IN ('pending', 'running')
		AND j."payload" ->> 'mode' = 'force'
)
ON CONFLICT ("key") DO UPDATE
SET "value" = 'true'::jsonb, "updated_at" = now();--> statement-breakpoint
DELETE FROM "job"
WHERE "kind" IN ('clip.encode', 'clip.renditions-sweep');--> statement-breakpoint
CREATE INDEX "clip_encode_request_claim_idx" ON "clip" USING btree ("encode_priority","encode_run_after","encode_requested_at","id") WHERE "clip"."encode_request_id" is not null;--> statement-breakpoint
CREATE INDEX "clip_encode_generation_claim_idx" ON "clip" USING btree ("encode_generation","id") WHERE "clip"."status" = 'ready' and "clip"."source_key" is not null;--> statement-breakpoint
CREATE INDEX "clip_encode_active_idx" ON "clip" USING btree ("encode_locked_at") WHERE "clip"."encode_run_id" is not null;--> statement-breakpoint
CREATE TABLE "storage_deletion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" text NOT NULL,
	"storage_key" text NOT NULL,
	"abort_upload" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_deletion_namespace_check" CHECK ("storage_deletion"."namespace" in ('clips', 'thumbnails', 'assets')),
	CONSTRAINT "storage_deletion_attempts_check" CHECK ("storage_deletion"."attempts" >= 0),
	CONSTRAINT "storage_deletion_revision_check" CHECK ("storage_deletion"."revision" > 0),
	CONSTRAINT "storage_deletion_key_check" CHECK (char_length("storage_deletion"."storage_key") between 1 and 2048),
	CONSTRAINT "storage_deletion_reason_check" CHECK (char_length(btrim("storage_deletion"."reason")) between 1 and 500),
	CONSTRAINT "storage_deletion_source_type_check" CHECK (char_length(btrim("storage_deletion"."source_type")) between 1 and 100),
	CONSTRAINT "storage_deletion_source_id_check" CHECK ("storage_deletion"."source_id" is null or char_length(btrim("storage_deletion"."source_id")) between 1 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "storage_deletion_object_idx" ON "storage_deletion" USING btree ("namespace","storage_key");--> statement-breakpoint
CREATE INDEX "storage_deletion_next_attempt_idx" ON "storage_deletion" USING btree ("next_attempt_at","created_at");--> statement-breakpoint
ALTER TABLE "auth_challenge" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "auth_challenge" AS "challenge"
SET "user_id" = "owner"."id"
FROM "user" AS "owner"
WHERE "challenge"."user_id" IS NULL
  AND lower("challenge"."payload"->>'userId') = lower("owner"."id"::text);--> statement-breakpoint
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_challenge_user_idx" ON "auth_challenge" USING btree ("user_id");--> statement-breakpoint
DELETE FROM "job" WHERE "kind" = 'auth.challenge-prune';--> statement-breakpoint
CREATE INDEX "notification_retention_read_idx" ON "notification" USING btree ("created_at","id") WHERE "notification"."read_at" is not null;--> statement-breakpoint
CREATE INDEX "notification_retention_unread_idx" ON "notification" USING btree ("created_at","id") WHERE "notification"."read_at" is null;--> statement-breakpoint
DELETE FROM "job" WHERE "kind" = 'notification.prune';--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "upload_cleanup_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "clip_pending_upload_cleanup_idx" ON "clip" USING btree ("upload_cleanup_at","id") WHERE "clip"."status" = 'pending' and "clip"."upload_cleanup_at" is not null;--> statement-breakpoint
DROP INDEX "upload_ticket_expires_idx";--> statement-breakpoint
DROP INDEX "upload_ticket_used_idx";--> statement-breakpoint
CREATE INDEX "upload_ticket_unused_expiry_idx" ON "upload_ticket" USING btree ("expires_at","id") WHERE "upload_ticket"."used_at" is null;--> statement-breakpoint
DELETE FROM "job" WHERE "kind" = 'upload.cleanup';
