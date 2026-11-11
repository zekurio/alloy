CREATE TABLE "user_recovery_key" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_recovery_key" ADD CONSTRAINT "user_recovery_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;