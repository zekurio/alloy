-- Drops upload_ticket's target_type and role, and converts every naive
-- timestamp column to timestamptz. The naive columns stored UTC wall time,
-- so they are read as UTC explicitly; the conversion must not depend on the
-- session or database time zone. clip.published_at and user.created_at drop
-- to millisecond precision so keyset cursors, which carry a JS Date, match
-- the stored value exactly.
ALTER TABLE "upload_ticket" DROP CONSTRAINT "upload_ticket_role_check";--> statement-breakpoint
ALTER TABLE "upload_ticket" DROP CONSTRAINT "upload_ticket_target_check";--> statement-breakpoint
DROP INDEX "upload_ticket_unused_expiry_idx";--> statement-breakpoint
DROP INDEX "upload_ticket_target_idx";--> statement-breakpoint
ALTER TABLE "clip" ALTER COLUMN "thumb_failed_at" SET DATA TYPE timestamp with time zone USING "thumb_failed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "clip" ALTER COLUMN "published_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "clip" ALTER COLUMN "encode_locked_at" SET DATA TYPE timestamp with time zone USING "encode_locked_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "clip" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "clip" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "clip" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "clip" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "clip_rendition" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "clip_rendition" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "clip_view" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "clip_view" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "game" ALTER COLUMN "release_date" SET DATA TYPE timestamp with time zone USING "release_date" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "game" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "game" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "game" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "game" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "game" ALTER COLUMN "refresh_after" SET DATA TYPE timestamp with time zone USING "refresh_after" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "instance_setting" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "instance_setting" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "upload_ticket" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "upload_ticket" ALTER COLUMN "used_at" SET DATA TYPE timestamp with time zone USING "used_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "upload_ticket" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "upload_ticket" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "block" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "block" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_theme" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "user_theme" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_theme" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "user_theme" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_account" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth_account" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_account" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth_account" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_challenge" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth_challenge" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth_challenge" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "last_seen_at" SET DATA TYPE timestamp with time zone USING "last_seen_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "last_seen_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "disabled_at" SET DATA TYPE timestamp with time zone USING "disabled_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "admin_suspended_at" SET DATA TYPE timestamp with time zone USING "admin_suspended_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_passkey" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "user_passkey" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_passkey" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "user_passkey" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user_passkey" ALTER COLUMN "last_used_at" SET DATA TYPE timestamp with time zone USING "last_used_at" AT TIME ZONE 'UTC';--> statement-breakpoint
CREATE INDEX "upload_ticket_target_idx" ON "upload_ticket" USING btree ("target_id");--> statement-breakpoint
ALTER TABLE "upload_ticket" DROP COLUMN "target_type";--> statement-breakpoint
ALTER TABLE "upload_ticket" DROP COLUMN "role";
