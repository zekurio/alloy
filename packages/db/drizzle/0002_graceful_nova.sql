-- Scrubber tickets are no longer valid. They are transient and safe to drop
-- before tightening the role constraint.
DELETE FROM "upload_ticket" WHERE "role" = 'scrubber';--> statement-breakpoint
ALTER TABLE "upload_ticket" DROP CONSTRAINT "upload_ticket_role_check";--> statement-breakpoint
ALTER TABLE "upload_ticket" ADD CONSTRAINT "upload_ticket_role_check" CHECK ("upload_ticket"."role" in ('video'));
