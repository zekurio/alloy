ALTER TABLE "clip" ADD COLUMN "source_fps" integer;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_fingerprint" text;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_failed_fingerprint" text;--> statement-breakpoint
CREATE INDEX "clip_ready_fingerprint_idx" ON "clip" USING btree ("id") WHERE "clip"."status" = 'ready' and "clip"."source_key" is not null;