ALTER TABLE "auth_challenge" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "auth_challenge" AS "challenge"
SET "user_id" = "owner"."id"
FROM "user" AS "owner"
WHERE "challenge"."user_id" IS NULL
  AND lower("challenge"."payload"->>'userId') = lower("owner"."id"::text);--> statement-breakpoint
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_challenge_user_idx" ON "auth_challenge" USING btree ("user_id");
