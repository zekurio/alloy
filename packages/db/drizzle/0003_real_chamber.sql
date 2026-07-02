DROP INDEX "clip_rendition_clip_height_idx";--> statement-breakpoint
ALTER TABLE "clip_rendition" ADD COLUMN "name" text;--> statement-breakpoint
UPDATE "clip_rendition" SET "name" = "height" || 'p';--> statement-breakpoint
ALTER TABLE "clip_rendition" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clip_rendition" ADD COLUMN "is_og" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "clip_rendition_clip_name_idx" ON "clip_rendition" USING btree ("clip_id","name");
