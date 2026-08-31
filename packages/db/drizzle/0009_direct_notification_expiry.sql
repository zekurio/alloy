CREATE INDEX "notification_retention_read_idx" ON "notification" USING btree ("created_at","id") WHERE "notification"."read_at" is not null;--> statement-breakpoint
CREATE INDEX "notification_retention_unread_idx" ON "notification" USING btree ("created_at","id") WHERE "notification"."read_at" is null;--> statement-breakpoint
DELETE FROM "job" WHERE "kind" = 'notification.prune';
