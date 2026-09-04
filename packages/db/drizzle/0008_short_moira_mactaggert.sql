ALTER TABLE "user" ADD COLUMN "admin_suspended_at" timestamp;--> statement-breakpoint
UPDATE "user"
SET
	"disabled_at" = COALESCE("disabled_at", "updated_at"),
	"admin_suspended_at" = COALESCE("disabled_at", "updated_at")
WHERE "status" = 'disabled';--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_admin_suspension_check" CHECK ("user"."admin_suspended_at" is null or "user"."status" = 'disabled');
