ALTER TABLE "clip" ADD COLUMN "encode_stage" text;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_tier" text;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_tier_index" integer;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "encode_tier_count" integer;--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_encode_stage_check" CHECK ("clip"."encode_stage" is null or "clip"."encode_stage" in ('downloading', 'processing', 'encoding', 'finalizing'));