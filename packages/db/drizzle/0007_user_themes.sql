CREATE TABLE "user_theme" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"light" jsonb,
	"dark" jsonb,
	"guided" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_theme_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "user_theme_appearance_check" CHECK ("user_theme"."light" is not null or "user_theme"."dark" is not null)
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "theme_preferences" jsonb;--> statement-breakpoint
ALTER TABLE "user_theme" ADD CONSTRAINT "user_theme_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;