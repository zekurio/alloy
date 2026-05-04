ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_username_unique";

CREATE UNIQUE INDEX "user_username_lower_unique" ON "user" USING btree (lower("username"));
