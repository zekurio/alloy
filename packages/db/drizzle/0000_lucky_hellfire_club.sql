CREATE TABLE "block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"game" text,
	"game_id" uuid NOT NULL,
	"privacy" text DEFAULT 'public' NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"trim_start_ms" integer,
	"trim_end_ms" integer,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thumb_key" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"encode_progress" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clip_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "clip_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"pinned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "clip_comment_like" (
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clip_comment_like_comment_id_user_id_pk" PRIMARY KEY("comment_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "clip_like" (
	"clip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clip_like_clip_id_user_id_pk" PRIMARY KEY("clip_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "clip_mention" (
	"clip_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	CONSTRAINT "clip_mention_clip_id_mentioned_user_id_pk" PRIMARY KEY("clip_id","mentioned_user_id")
);
--> statement-breakpoint
CREATE TABLE "clip_view" (
	"clip_id" uuid NOT NULL,
	"viewer_key" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clip_view_clip_id_viewer_key_pk" PRIMARY KEY("clip_id","viewer_key")
);
--> statement-breakpoint
CREATE TABLE "follow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"steamgriddb_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"release_date" timestamp,
	"hero_url" text,
	"grid_url" text,
	"logo_url" text,
	"icon_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_steamgriddb_id_unique" UNIQUE("steamgriddb_id"),
	CONSTRAINT "game_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "game_follow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"clip_id" uuid,
	"comment_id" uuid,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"email" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"identifier" text NOT NULL,
	"challenge" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	CONSTRAINT "auth_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"username" text NOT NULL,
	"display_username" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"image" text,
	"banner" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"disabled_at" timestamp,
	"storage_quota_bytes" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "user_passkey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"name" text,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "user_passkey_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocker_id_user_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocked_id_user_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment" ADD CONSTRAINT "clip_comment_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment" ADD CONSTRAINT "clip_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment" ADD CONSTRAINT "clip_comment_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."clip_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment_like" ADD CONSTRAINT "clip_comment_like_comment_id_clip_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."clip_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment_like" ADD CONSTRAINT "clip_comment_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_like" ADD CONSTRAINT "clip_like_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_like" ADD CONSTRAINT "clip_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_mention" ADD CONSTRAINT "clip_mention_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_mention" ADD CONSTRAINT "clip_mention_mentioned_user_id_user_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_view" ADD CONSTRAINT "clip_view_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_view" ADD CONSTRAINT "clip_view_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_follower_id_user_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_following_id_user_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_follow" ADD CONSTRAINT "game_follow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_follow" ADD CONSTRAINT "game_follow_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_comment_id_clip_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."clip_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_passkey" ADD CONSTRAINT "user_passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "block_pair_idx" ON "block" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "clip_author_idx" ON "clip" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "clip_privacy_created_idx" ON "clip" USING btree ("privacy","created_at");--> statement-breakpoint
CREATE INDEX "clip_status_idx" ON "clip" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clip_game_created_idx" ON "clip" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "clip_comment_clip_created_idx" ON "clip_comment" USING btree ("clip_id","created_at");--> statement-breakpoint
CREATE INDEX "clip_comment_parent_idx" ON "clip_comment" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clip_comment_one_pin_per_clip_idx" ON "clip_comment" USING btree ("clip_id") WHERE "clip_comment"."pinned_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "clip_comment_like_user_idx" ON "clip_comment_like" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "clip_like_user_idx" ON "clip_like" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "clip_mention_user_idx" ON "clip_mention" USING btree ("mentioned_user_id");--> statement-breakpoint
CREATE INDEX "clip_view_user_clip_idx" ON "clip_view" USING btree ("user_id","clip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_pair_idx" ON "follow" USING btree ("follower_id","following_id");--> statement-breakpoint
CREATE INDEX "follow_following_idx" ON "follow" USING btree ("following_id");--> statement-breakpoint
CREATE INDEX "game_name_idx" ON "game" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "game_follow_pair_idx" ON "game_follow" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "game_follow_game_idx" ON "game_follow" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "notification_recipient_created_idx" ON "notification" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_recipient_unread_idx" ON "notification" USING btree ("recipient_id","created_at") WHERE "notification"."read_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_account_idx" ON "auth_account" USING btree ("provider_id","provider_account_id");