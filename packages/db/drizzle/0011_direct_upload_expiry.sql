DROP INDEX "upload_ticket_expires_idx";--> statement-breakpoint
DROP INDEX "upload_ticket_used_idx";--> statement-breakpoint
CREATE INDEX "upload_ticket_unused_expiry_idx" ON "upload_ticket" USING btree ("expires_at","id") WHERE "upload_ticket"."used_at" is null;--> statement-breakpoint
DELETE FROM "job" WHERE "kind" = 'upload.cleanup';
