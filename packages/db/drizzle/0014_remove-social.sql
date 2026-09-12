ALTER TABLE "clip_comment" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clip_comment_like" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clip_comment_mention" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clip_like" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "game_follow" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "follow" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "clip_comment" CASCADE;--> statement-breakpoint
DROP TABLE "clip_comment_like" CASCADE;--> statement-breakpoint
DROP TABLE "clip_comment_mention" CASCADE;--> statement-breakpoint
DROP TABLE "clip_like" CASCADE;--> statement-breakpoint
DROP TABLE "game_follow" CASCADE;--> statement-breakpoint
DROP TABLE "notification" CASCADE;--> statement-breakpoint
DROP TABLE "follow" CASCADE;--> statement-breakpoint
DROP INDEX "clip_ready_visible_top_idx";--> statement-breakpoint
DROP INDEX "clip_ready_visible_game_top_idx";--> statement-breakpoint
CREATE INDEX "clip_ready_visible_top_idx" ON "clip" USING btree ("view_count" DESC NULLS LAST,"published_at" DESC NULLS LAST,"id") WHERE "clip"."status" = 'ready' and "clip"."privacy" = 'public';--> statement-breakpoint
CREATE INDEX "clip_ready_visible_game_top_idx" ON "clip" USING btree ("game_id","view_count" DESC NULLS LAST,"published_at" DESC NULLS LAST,"id") WHERE "clip"."status" = 'ready' and "clip"."privacy" = 'public';--> statement-breakpoint
ALTER TABLE "clip" DROP COLUMN "like_count";--> statement-breakpoint
ALTER TABLE "clip" DROP COLUMN "comment_count";