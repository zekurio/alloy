CREATE TABLE "webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_delivery_status" integer,
	"last_delivery_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_provider_check" CHECK ("webhook"."provider" in ('discord', 'generic'))
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"clip_id" uuid,
	"event" text NOT NULL,
	"dedup_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "webhook_delivery_event_check" CHECK ("webhook_delivery"."event" in ('clip.published')),
	CONSTRAINT "webhook_delivery_status_check" CHECK ("webhook_delivery"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "clip_announcements_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_enabled_idx" ON "webhook" USING btree ("enabled") WHERE "webhook"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_dedup_idx" ON "webhook_delivery" USING btree ("webhook_id","dedup_key");--> statement-breakpoint
CREATE INDEX "webhook_delivery_clip_idx" ON "webhook_delivery" USING btree ("clip_id");