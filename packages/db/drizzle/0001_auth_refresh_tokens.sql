CREATE TABLE "auth_refresh_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"absolute_expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "auth_refresh_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "auth_refresh_token" ADD CONSTRAINT "auth_refresh_token_session_id_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_refresh_token_session_idx" ON "auth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "auth_refresh_token_expires_at_idx" ON "auth_refresh_token" USING btree ("expires_at");