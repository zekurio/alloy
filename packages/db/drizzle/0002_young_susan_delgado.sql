CREATE TABLE "clip_rendition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_id" uuid NOT NULL,
	"height" integer NOT NULL,
	"width" integer NOT NULL,
	"fps" integer NOT NULL,
	"storage_key" text NOT NULL,
	"playlist" text NOT NULL,
	"codecs" text NOT NULL,
	"bandwidth" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clip_rendition_size_bytes_safe_check" CHECK ("clip_rendition"."size_bytes" >= 0 and "clip_rendition"."size_bytes" <= 9007199254740991),
	CONSTRAINT "clip_rendition_height_check" CHECK ("clip_rendition"."height" > 0)
);
--> statement-breakpoint
ALTER TABLE "clip_rendition" ADD CONSTRAINT "clip_rendition_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clip_rendition_clip_height_idx" ON "clip_rendition" USING btree ("clip_id","height");