ALTER TABLE "notification" DROP CONSTRAINT "notification_kind_check";--> statement-breakpoint
-- Processing failures live in the upload center now; retire their rows before
-- the tightened kind constraint lands.
DELETE FROM "notification" WHERE "kind" = 'clip_processing_failed';--> statement-breakpoint
DROP INDEX "clip_privacy_created_idx";--> statement-breakpoint
DROP INDEX "clip_game_created_idx";--> statement-breakpoint
DROP INDEX "clip_ready_visible_top_idx";--> statement-breakpoint
DROP INDEX "clip_ready_visible_game_top_idx";--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
-- Existing public clips were announced at upload time, so created_at is the
-- honest publish moment for everything already live.
UPDATE "clip" SET "published_at" = "created_at" WHERE "status" = 'ready' AND "privacy" = 'public';--> statement-breakpoint
CREATE INDEX "clip_privacy_published_idx" ON "clip" USING btree ("privacy","published_at");--> statement-breakpoint
CREATE INDEX "clip_game_published_idx" ON "clip" USING btree ("game_id","published_at");--> statement-breakpoint
CREATE INDEX "clip_ready_visible_top_idx" ON "clip" USING btree ("view_count" DESC NULLS LAST,"like_count" DESC NULLS LAST,"published_at" DESC NULLS LAST,"id") WHERE "clip"."status" = 'ready' and "clip"."privacy" = 'public';--> statement-breakpoint
CREATE INDEX "clip_ready_visible_game_top_idx" ON "clip" USING btree ("game_id","view_count" DESC NULLS LAST,"like_count" DESC NULLS LAST,"published_at" DESC NULLS LAST,"id") WHERE "clip"."status" = 'ready' and "clip"."privacy" = 'public';--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_kind_check" CHECK ("notification"."kind" in ('follow', 'clip_like', 'clip_comment', 'comment_reply', 'clip_mention', 'comment_mention', 'comment_like'));
