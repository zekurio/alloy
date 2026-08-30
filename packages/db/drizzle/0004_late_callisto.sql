ALTER TABLE "webhook_delivery" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "webhook_delivery_pending_idx" ON "webhook_delivery" USING btree ("next_attempt_at","created_at") WHERE "webhook_delivery"."status" = 'pending';--> statement-breakpoint
DELETE FROM "job" WHERE "kind" = 'webhook.deliver';
