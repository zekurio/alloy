ALTER TABLE "clip" ADD COLUMN "source_codecs" text;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "source_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "cut_key" text;