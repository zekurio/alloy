ALTER TABLE "user" DROP CONSTRAINT "user_storage_quota_bytes_safe_check";--> statement-breakpoint
UPDATE "user" SET "storage_quota_bytes" = 1 WHERE "storage_quota_bytes" = 0;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_storage_quota_bytes_safe_check" CHECK ("user"."storage_quota_bytes" is null or ("user"."storage_quota_bytes" > 0 and "user"."storage_quota_bytes" <= 9007199254740991));
