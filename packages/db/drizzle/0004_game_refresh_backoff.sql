ALTER TABLE "game" ADD COLUMN "refresh_after" timestamp;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "refresh_failures" integer DEFAULT 0 NOT NULL;