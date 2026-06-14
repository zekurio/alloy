CREATE TABLE "clip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"game" text,
	"steamgriddb_id" integer NOT NULL,
	"privacy" text DEFAULT 'public' NOT NULL,
	"origin_device_id" uuid,
	"game_session_id" uuid,
	"source_key" text,
	"source_content_type" text,
	"source_video_codec" text,
	"source_audio_codec" text,
	"source_size_bytes" bigint,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"thumb_key" text,
	"thumb_blur_hash" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"trim_start_ms" integer,
	"trim_end_ms" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"encode_progress" integer DEFAULT 0 NOT NULL,
	"encode_run_id" uuid,
	"encode_locked_at" timestamp,
	"encode_attempt" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clip_privacy_check" CHECK ("clip"."privacy" in ('public', 'unlisted')),
	CONSTRAINT "clip_status_check" CHECK ("clip"."status" in ('pending', 'processing', 'ready', 'failed')),
	CONSTRAINT "clip_source_size_bytes_safe_check" CHECK ("clip"."source_size_bytes" is null or ("clip"."source_size_bytes" >= 0 and "clip"."source_size_bytes" <= 9007199254740991))
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
CREATE TABLE "clip_tag" (
	"clip_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "clip_tag_clip_id_tag_pk" PRIMARY KEY("clip_id","tag")
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
CREATE TABLE "game" (
	"steamgriddb_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"release_date" timestamp,
	"hero_url" text,
	"hero_blur_hash" text,
	"grid_url" text,
	"grid_blur_hash" text,
	"logo_url" text,
	"icon_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "game_follow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"steamgriddb_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staging_recording" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text DEFAULT 'clip' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"game" text,
	"steamgriddb_id" integer,
	"origin_device_id" uuid,
	"game_session_id" uuid,
	"source_key" text,
	"source_content_type" text,
	"source_video_codec" text,
	"source_audio_codec" text,
	"source_size_bytes" bigint,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"thumb_key" text,
	"thumb_blur_hash" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"trim_start_ms" integer,
	"trim_end_ms" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"encode_progress" integer DEFAULT 0 NOT NULL,
	"encode_run_id" uuid,
	"encode_locked_at" timestamp,
	"encode_attempt" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staging_recording_kind_check" CHECK ("staging_recording"."kind" in ('clip', 'session')),
	CONSTRAINT "staging_recording_status_check" CHECK ("staging_recording"."status" in ('pending', 'processing', 'ready', 'failed')),
	CONSTRAINT "staging_recording_source_size_bytes_safe_check" CHECK ("staging_recording"."source_size_bytes" is null or ("staging_recording"."source_size_bytes" >= 0 and "staging_recording"."source_size_bytes" <= 9007199254740991))
);
--> statement-breakpoint
CREATE TABLE "upload_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"role" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"expected_bytes" bigint NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "upload_ticket_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "upload_ticket_role_check" CHECK ("upload_ticket"."role" in ('video', 'thumb')),
	CONSTRAINT "upload_ticket_target_check" CHECK ("upload_ticket"."target_type" in ('clip', 'staging')),
	CONSTRAINT "upload_ticket_expected_bytes_safe_check" CHECK ("upload_ticket"."expected_bytes" > 0 and "upload_ticket"."expected_bytes" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_type_check" CHECK ("notification"."type" in ('clip_upload_failed', 'new_follower', 'clip_comment', 'comment_reply', 'comment_pinned', 'comment_liked_by_author', 'new_video'))
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
	"image" text,
	"banner" text,
	"background" text,
	"accent_color" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"disabled_at" timestamp,
	"storage_quota_bytes" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_role_check" CHECK ("user"."role" in ('user', 'admin')),
	CONSTRAINT "user_status_check" CHECK ("user"."status" in ('active', 'disabled')),
	CONSTRAINT "user_storage_quota_bytes_safe_check" CHECK ("user"."storage_quota_bytes" is null or ("user"."storage_quota_bytes" > 0 and "user"."storage_quota_bytes" <= 9007199254740991))
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
ALTER TABLE "clip" ADD CONSTRAINT "clip_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_steamgriddb_id_game_steamgriddb_id_fk" FOREIGN KEY ("steamgriddb_id") REFERENCES "public"."game"("steamgriddb_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_origin_device_id_user_device_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "public"."user_device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip" ADD CONSTRAINT "clip_game_session_id_game_session_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment" ADD CONSTRAINT "clip_comment_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment" ADD CONSTRAINT "clip_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment" ADD CONSTRAINT "clip_comment_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."clip_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment_like" ADD CONSTRAINT "clip_comment_like_comment_id_clip_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."clip_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_comment_like" ADD CONSTRAINT "clip_comment_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_like" ADD CONSTRAINT "clip_like_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_like" ADD CONSTRAINT "clip_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_mention" ADD CONSTRAINT "clip_mention_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_mention" ADD CONSTRAINT "clip_mention_mentioned_user_id_user_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_tag" ADD CONSTRAINT "clip_tag_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_view" ADD CONSTRAINT "clip_view_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_view" ADD CONSTRAINT "clip_view_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_device_id_user_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."user_device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_steamgriddb_id_game_steamgriddb_id_fk" FOREIGN KEY ("steamgriddb_id") REFERENCES "public"."game"("steamgriddb_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_device" ADD CONSTRAINT "user_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_follow" ADD CONSTRAINT "game_follow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_follow" ADD CONSTRAINT "game_follow_steamgriddb_id_game_steamgriddb_id_fk" FOREIGN KEY ("steamgriddb_id") REFERENCES "public"."game"("steamgriddb_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_recording" ADD CONSTRAINT "staging_recording_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_recording" ADD CONSTRAINT "staging_recording_steamgriddb_id_game_steamgriddb_id_fk" FOREIGN KEY ("steamgriddb_id") REFERENCES "public"."game"("steamgriddb_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_recording" ADD CONSTRAINT "staging_recording_origin_device_id_user_device_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "public"."user_device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_recording" ADD CONSTRAINT "staging_recording_game_session_id_game_session_id_fk" FOREIGN KEY ("game_session_id") REFERENCES "public"."game_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_ticket" ADD CONSTRAINT "upload_ticket_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocker_id_user_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocked_id_user_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_follower_id_user_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_following_id_user_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_comment_id_clip_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."clip_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_passkey" ADD CONSTRAINT "user_passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_author_idx" ON "clip" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "clip_privacy_created_idx" ON "clip" USING btree ("privacy","created_at");--> statement-breakpoint
CREATE INDEX "clip_ready_visible_top_idx" ON "clip" USING btree ("view_count" DESC NULLS LAST,"like_count" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id") WHERE "clip"."status" = 'ready' and "clip"."privacy" = 'public';--> statement-breakpoint
CREATE INDEX "clip_status_idx" ON "clip" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clip_steamgriddb_created_idx" ON "clip" USING btree ("steamgriddb_id","created_at");--> statement-breakpoint
CREATE INDEX "clip_game_session_idx" ON "clip" USING btree ("game_session_id");--> statement-breakpoint
CREATE INDEX "clip_ready_visible_steamgriddb_top_idx" ON "clip" USING btree ("steamgriddb_id","view_count" DESC NULLS LAST,"like_count" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id") WHERE "clip"."status" = 'ready' and "clip"."privacy" = 'public';--> statement-breakpoint
CREATE INDEX "clip_comment_clip_created_idx" ON "clip_comment" USING btree ("clip_id","created_at");--> statement-breakpoint
CREATE INDEX "clip_comment_parent_idx" ON "clip_comment" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clip_comment_one_pin_per_clip_idx" ON "clip_comment" USING btree ("clip_id") WHERE "clip_comment"."pinned_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "clip_comment_like_user_idx" ON "clip_comment_like" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "clip_like_user_idx" ON "clip_like" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "clip_mention_user_idx" ON "clip_mention" USING btree ("mentioned_user_id");--> statement-breakpoint
CREATE INDEX "clip_tag_tag_idx" ON "clip_tag" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "clip_view_user_clip_idx" ON "clip_view" USING btree ("user_id","clip_id");--> statement-breakpoint
CREATE INDEX "game_session_user_started_idx" ON "game_session" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "user_device_user_idx" ON "user_device" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "game_name_idx" ON "game" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "game_follow_pair_idx" ON "game_follow" USING btree ("user_id","steamgriddb_id");--> statement-breakpoint
CREATE INDEX "game_follow_steamgriddb_idx" ON "game_follow" USING btree ("steamgriddb_id");--> statement-breakpoint
CREATE INDEX "staging_recording_author_idx" ON "staging_recording" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "staging_recording_author_kind_created_idx" ON "staging_recording" USING btree ("author_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "staging_recording_status_idx" ON "staging_recording" USING btree ("status");--> statement-breakpoint
CREATE INDEX "staging_recording_game_session_idx" ON "staging_recording" USING btree ("game_session_id");--> statement-breakpoint
CREATE INDEX "upload_ticket_target_idx" ON "upload_ticket" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "upload_ticket_owner_idx" ON "upload_ticket" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "upload_ticket_expires_idx" ON "upload_ticket" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "upload_ticket_used_idx" ON "upload_ticket" USING btree ("used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "block_pair_idx" ON "block" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_pair_idx" ON "follow" USING btree ("follower_id","following_id");--> statement-breakpoint
CREATE INDEX "follow_following_idx" ON "follow" USING btree ("following_id");--> statement-breakpoint
CREATE INDEX "notification_recipient_created_idx" ON "notification" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_recipient_unread_idx" ON "notification" USING btree ("recipient_id","created_at") WHERE "notification"."read_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_account_idx" ON "auth_account" USING btree ("provider_id","provider_account_id");--> statement-breakpoint
CREATE INDEX "auth_challenge_expires_at_idx" ON "auth_challenge" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_challenge_purpose_identifier_idx" ON "auth_challenge" USING btree ("purpose","identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_lower_unique" ON "user" USING btree (lower("username"));