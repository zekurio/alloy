-- Sessions stop rotating. Keep every client that is signed in now: its
-- current refresh token becomes the session token, so the `alloy_refresh`
-- cookie it already holds keeps working until the server replaces it with
-- `alloy_session`. Sessions without a live refresh token are already over.
DELETE FROM "auth_session" AS "s"
WHERE NOT EXISTS (
  SELECT 1 FROM "auth_refresh_token" AS "r"
  WHERE "r"."session_id" = "s"."id"
    AND "r"."consumed_at" IS NULL
    AND "r"."revoked_at" IS NULL
);--> statement-breakpoint
UPDATE "auth_session" AS "s"
SET "token_hash" = "r"."token_hash", "expires_at" = "r"."expires_at"
FROM (
  SELECT DISTINCT ON ("session_id") "session_id", "token_hash", "expires_at"
  FROM "auth_refresh_token"
  WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL
  ORDER BY "session_id", "created_at" DESC
) AS "r"
WHERE "r"."session_id" = "s"."id";--> statement-breakpoint
ALTER TABLE "auth_refresh_token" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "auth_refresh_token" CASCADE;--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_session" DROP COLUMN "revoked_at";--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "client_kind" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "device_name" text;--> statement-breakpoint
-- Browsers always send a User-Agent; until now only the desktop app's code
-- exchange created sessions without one.
UPDATE "auth_session" SET "client_kind" = 'desktop' WHERE "user_agent" IS NULL;--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_client_kind_check" CHECK ("auth_session"."client_kind" in ('web', 'desktop'));--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_device_name_check" CHECK ("auth_session"."device_name" is null or char_length("auth_session"."device_name") between 1 and 64);
