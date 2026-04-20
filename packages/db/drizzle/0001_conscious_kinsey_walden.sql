CREATE TABLE "game" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"steamgriddb_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"release_date" timestamp,
	"hero_url" text,
	"logo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_steamgriddb_id_unique" UNIQUE("steamgriddb_id"),
	CONSTRAINT "game_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "game_id" uuid;--> statement-breakpoint
CREATE INDEX "game_name_idx" ON "game" USING btree ("name");--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_game_created_idx" ON "clip" USING btree ("game_id","created_at");