CREATE TABLE "game_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"game_name" text NOT NULL,
	"steamgriddb_id" integer,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "origin_device_id" uuid;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "game_session_id" uuid;--> statement-breakpoint
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_device_id_user_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."user_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_steamgriddb_id_game_steamgriddb_id_fk" FOREIGN KEY ("steamgriddb_id") REFERENCES "public"."game"("steamgriddb_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_device" ADD CONSTRAINT "user_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_session_user_started_idx" ON "game_session" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "user_device_user_idx" ON "user_device" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_origin_device_id_user_device_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "public"."user_device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_game_session_id_game_session_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_game_session_idx" ON "clip" USING btree ("game_session_id");