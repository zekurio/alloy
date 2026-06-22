ALTER TABLE "clip" DROP CONSTRAINT "clip_steamgriddb_id_game_steamgriddb_id_fk";
--> statement-breakpoint
ALTER TABLE "game_detection_mapping" DROP CONSTRAINT "game_detection_mapping_steamgriddb_id_game_steamgriddb_id_fk";
--> statement-breakpoint
ALTER TABLE "game_follow" DROP CONSTRAINT "game_follow_steamgriddb_id_game_steamgriddb_id_fk";
--> statement-breakpoint
DROP INDEX "clip_steamgriddb_created_idx";--> statement-breakpoint
DROP INDEX "clip_ready_visible_steamgriddb_top_idx";--> statement-breakpoint
DROP INDEX "game_detection_mapping_steamgriddb_idx";--> statement-breakpoint
DROP INDEX "game_follow_steamgriddb_idx";--> statement-breakpoint
DROP INDEX "game_follow_pair_idx";--> statement-breakpoint
/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'game'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

-- ALTER TABLE "game" DROP CONSTRAINT "<constraint_name>";--> statement-breakpoint
ALTER TABLE "game" ALTER COLUMN "steamgriddb_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "game_id" uuid;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "source" text DEFAULT 'steamgriddb' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_detection_mapping" ADD COLUMN "game_id" uuid;--> statement-breakpoint
ALTER TABLE "game_follow" ADD COLUMN "game_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_detection_mapping" ADD CONSTRAINT "game_detection_mapping_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_follow" ADD CONSTRAINT "game_follow_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_game_created_idx" ON "clip" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "clip_ready_visible_game_top_idx" ON "clip" USING btree ("game_id","view_count" DESC NULLS LAST,"like_count" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id") WHERE "clip"."status" = 'ready' and "clip"."privacy" = 'public';--> statement-breakpoint
CREATE INDEX "game_detection_mapping_game_idx" ON "game_detection_mapping" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_follow_game_idx" ON "game_follow" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_follow_pair_idx" ON "game_follow" USING btree ("user_id","game_id");--> statement-breakpoint
ALTER TABLE "clip" DROP COLUMN "steamgriddb_id";--> statement-breakpoint
ALTER TABLE "game_detection_mapping" DROP COLUMN "steamgriddb_id";--> statement-breakpoint
ALTER TABLE "game_follow" DROP COLUMN "steamgriddb_id";--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_steamgriddb_id_unique" UNIQUE("steamgriddb_id");--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_source_check" CHECK ("game"."source" in ('steamgriddb', 'custom'));