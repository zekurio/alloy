ALTER TABLE "user" ADD COLUMN "display_name" text;
UPDATE "user" SET "display_name" = "username";
ALTER TABLE "user" ALTER COLUMN "display_name" SET NOT NULL;
