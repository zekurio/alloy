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
CREATE INDEX "clip_encode_active_idx" ON "clip" USING btree ("encode_locked_at") WHERE "clip"."encode_run_id" is not null;
