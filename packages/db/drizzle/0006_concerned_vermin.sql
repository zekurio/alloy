ALTER TABLE "upload_ticket" DROP CONSTRAINT "upload_ticket_role_check";--> statement-breakpoint
-- Legacy poster upload tickets can otherwise block the narrowed role check.
-- Their staged objects are bounded orphan candidates for the normal storage GC.
DELETE FROM "upload_ticket" WHERE "role" = 'thumb';--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "thumb_failed_at" timestamp;--> statement-breakpoint
CREATE INDEX "clip_thumbnail_sweep_idx" ON "clip" USING btree ("id") WHERE "clip"."status" = 'ready' and "clip"."source_key" is not null and "clip"."thumb_key" is null and "clip"."thumb_failed_at" is null;--> statement-breakpoint
ALTER TABLE "upload_ticket" ADD CONSTRAINT "upload_ticket_role_check" CHECK ("upload_ticket"."role" in ('video'));
