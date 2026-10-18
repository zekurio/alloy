CREATE TABLE "clip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_kind" text DEFAULT 'video' NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"game" text,
	"game_id" uuid,
	"privacy" text DEFAULT 'public' NOT NULL,
	"source_key" text,
	"source_content_type" text,
	"source_video_codec" text,
	"source_audio_codec" text,
	"source_codecs" text,
	"source_size_bytes" bigint,
	"source_duration_ms" integer,
	"waveform_key" text,
	"source_fps" integer,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"thumb_key" text,
	"thumb_blur_hash" text,
	"thumb_failed_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"trim_start_ms" integer,
	"trim_end_ms" integer,
	"cut_key" text,
	"cut_codecs" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"upload_cleanup_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"queue_dismissed_at" timestamp with time zone,
	"encode_fingerprint" text,
	"encode_failed_fingerprint" text,
	"encode_progress" integer DEFAULT 0 NOT NULL,
	"encode_stage" text,
	"encode_tier" text,
	"encode_tier_index" integer,
	"encode_tier_count" integer,
	"encode_run_id" uuid,
	"encode_locked_at" timestamp,
	"encode_attempt" integer DEFAULT 0 NOT NULL,
	"encode_request_id" uuid,
	"encode_request_force" boolean DEFAULT false NOT NULL,
	"encode_requested_at" timestamp with time zone,
	"encode_run_after" timestamp with time zone,
	"encode_priority" integer DEFAULT 90 NOT NULL,
	"encode_claimed_request_id" uuid,
	"encode_generation" integer DEFAULT 0 NOT NULL,
	"encode_failed_generation" integer,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clip_media_kind_check" CHECK ("clip"."media_kind" in ('video', 'image')),
	CONSTRAINT "clip_image_timeline_check" CHECK ("clip"."media_kind" = 'video' or ("clip"."duration_ms" is null and "clip"."trim_start_ms" is null and "clip"."trim_end_ms" is null)),
	CONSTRAINT "clip_privacy_check" CHECK ("clip"."privacy" in ('public', 'unlisted', 'private')),
	CONSTRAINT "clip_status_check" CHECK ("clip"."status" in ('pending', 'processing', 'ready', 'failed')),
	CONSTRAINT "clip_encode_stage_check" CHECK ("clip"."encode_stage" is null or "clip"."encode_stage" in ('downloading', 'processing', 'encoding', 'finalizing')),
	CONSTRAINT "clip_source_size_bytes_safe_check" CHECK ("clip"."source_size_bytes" is null or ("clip"."source_size_bytes" >= 0 and "clip"."source_size_bytes" <= 9007199254740991))
);
--> statement-breakpoint
CREATE TABLE "clip_mention" (
	"clip_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	CONSTRAINT "clip_mention_clip_id_mentioned_user_id_pk" PRIMARY KEY("clip_id","mentioned_user_id")
);
--> statement-breakpoint
CREATE TABLE "clip_rendition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_og" boolean DEFAULT false NOT NULL,
	"height" integer NOT NULL,
	"width" integer NOT NULL,
	"fps" integer NOT NULL,
	"storage_key" text NOT NULL,
	"codecs" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clip_rendition_size_bytes_safe_check" CHECK ("clip_rendition"."size_bytes" >= 0 and "clip_rendition"."size_bytes" <= 9007199254740991),
	CONSTRAINT "clip_rendition_height_check" CHECK ("clip_rendition"."height" > 0)
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
CREATE TABLE "game" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"steamgriddb_id" integer,
	"source" text DEFAULT 'steamgriddb' NOT NULL,
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
	CONSTRAINT "game_steamgriddb_id_unique" UNIQUE("steamgriddb_id"),
	CONSTRAINT "game_slug_unique" UNIQUE("slug"),
	CONSTRAINT "game_source_check" CHECK ("game"."source" in ('steamgriddb', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "game_detection_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_id" text,
	"executable" text,
	"normalized_name" text NOT NULL,
	"game_id" uuid,
	"status" text NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"upload_state" jsonb,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "upload_ticket_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "upload_ticket_role_check" CHECK ("upload_ticket"."role" in ('video')),
	CONSTRAINT "upload_ticket_target_check" CHECK ("upload_ticket"."target_type" in ('clip')),
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
CREATE TABLE "storage_deletion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" text NOT NULL,
	"storage_key" text NOT NULL,
	"abort_upload" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_deletion_namespace_check" CHECK ("storage_deletion"."namespace" in ('clips', 'thumbnails', 'assets')),
	CONSTRAINT "storage_deletion_attempts_check" CHECK ("storage_deletion"."attempts" >= 0),
	CONSTRAINT "storage_deletion_revision_check" CHECK ("storage_deletion"."revision" > 0),
	CONSTRAINT "storage_deletion_key_check" CHECK (char_length("storage_deletion"."storage_key") between 1 and 2048),
	CONSTRAINT "storage_deletion_reason_check" CHECK (char_length(btrim("storage_deletion"."reason")) between 1 and 500),
	CONSTRAINT "storage_deletion_source_type_check" CHECK (char_length(btrim("storage_deletion"."source_type")) between 1 and 100),
	CONSTRAINT "storage_deletion_source_id_check" CHECK ("storage_deletion"."source_id" is null or char_length(btrim("storage_deletion"."source_id")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_delivery_status" integer,
	"last_delivery_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_provider_check" CHECK ("webhook"."provider" in ('discord', 'generic'))
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"clip_id" uuid,
	"event" text NOT NULL,
	"dedup_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_status" integer,
	"discord_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "webhook_delivery_event_check" CHECK ("webhook_delivery"."event" in ('clip.published')),
	CONSTRAINT "webhook_delivery_status_check" CHECK ("webhook_delivery"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"account_label" text,
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
	"user_id" uuid,
	"purpose" text NOT NULL,
	"identifier" text NOT NULL,
	"challenge" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"revoked_at" timestamp,
	CONSTRAINT "auth_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"image" text,
	"banner" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"disabled_at" timestamp,
	"admin_suspended_at" timestamp,
	"storage_quota_bytes" bigint,
	"clip_announcements_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_check" CHECK ("user"."role" in ('user', 'admin')),
	CONSTRAINT "user_status_check" CHECK ("user"."status" in ('active', 'disabled')),
	CONSTRAINT "user_admin_suspension_check" CHECK ("user"."admin_suspended_at" is null or "user"."status" = 'disabled'),
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
ALTER TABLE "clip" ADD CONSTRAINT "clip_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_mention" ADD CONSTRAINT "clip_mention_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_mention" ADD CONSTRAINT "clip_mention_mentioned_user_id_user_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_rendition" ADD CONSTRAINT "clip_rendition_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_tag" ADD CONSTRAINT "clip_tag_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_view" ADD CONSTRAINT "clip_view_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_view" ADD CONSTRAINT "clip_view_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_detection_mapping" ADD CONSTRAINT "game_detection_mapping_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_ticket" ADD CONSTRAINT "upload_ticket_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocker_id_user_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocked_id_user_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_refresh_token" ADD CONSTRAINT "auth_refresh_token_session_id_auth_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_passkey" ADD CONSTRAINT "user_passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_author_idx" ON "clip" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "clip_privacy_published_idx" ON "clip" USING btree ("privacy","published_at");--> statement-breakpoint
CREATE INDEX "clip_ready_visible_top_idx" ON "clip" USING btree ("view_count" DESC NULLS LAST,"published_at" DESC NULLS LAST,"id") WHERE "clip"."status" = 'ready' and "clip"."privacy" = 'public';--> statement-breakpoint
CREATE INDEX "clip_status_idx" ON "clip" USING btree ("status");--> statement-breakpoint
CREATE INDEX "clip_pending_upload_cleanup_idx" ON "clip" USING btree ("upload_cleanup_at","id") WHERE "clip"."status" = 'pending' and "clip"."upload_cleanup_at" is not null;--> statement-breakpoint
CREATE INDEX "clip_ready_fingerprint_idx" ON "clip" USING btree ("id") WHERE "clip"."status" = 'ready' and "clip"."source_key" is not null;--> statement-breakpoint
CREATE INDEX "clip_thumbnail_sweep_idx" ON "clip" USING btree ("id") WHERE "clip"."status" = 'ready' and "clip"."source_key" is not null and "clip"."thumb_key" is null and "clip"."thumb_failed_at" is null;--> statement-breakpoint
CREATE INDEX "clip_encode_request_claim_idx" ON "clip" USING btree ("encode_priority","encode_run_after","encode_requested_at","id") WHERE "clip"."encode_request_id" is not null;--> statement-breakpoint
CREATE INDEX "clip_encode_generation_claim_idx" ON "clip" USING btree ("encode_generation","id") WHERE "clip"."status" = 'ready' and "clip"."source_key" is not null;--> statement-breakpoint
CREATE INDEX "clip_encode_active_idx" ON "clip" USING btree ("encode_locked_at") WHERE "clip"."encode_run_id" is not null;--> statement-breakpoint
CREATE INDEX "clip_game_published_idx" ON "clip" USING btree ("game_id","published_at");--> statement-breakpoint
CREATE INDEX "clip_ready_visible_game_top_idx" ON "clip" USING btree ("game_id","view_count" DESC NULLS LAST,"published_at" DESC NULLS LAST,"id") WHERE "clip"."status" = 'ready' and "clip"."privacy" = 'public';--> statement-breakpoint
CREATE INDEX "clip_mention_user_idx" ON "clip_mention" USING btree ("mentioned_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clip_rendition_clip_name_idx" ON "clip_rendition" USING btree ("clip_id","name");--> statement-breakpoint
CREATE INDEX "clip_tag_tag_idx" ON "clip_tag" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "clip_view_user_clip_idx" ON "clip_view" USING btree ("user_id","clip_id");--> statement-breakpoint
CREATE INDEX "game_name_idx" ON "game" USING btree ("name");--> statement-breakpoint
CREATE INDEX "game_detection_mapping_source_idx" ON "game_detection_mapping" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "game_detection_mapping_executable_idx" ON "game_detection_mapping" USING btree ("executable");--> statement-breakpoint
CREATE INDEX "game_detection_mapping_name_idx" ON "game_detection_mapping" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "game_detection_mapping_game_idx" ON "game_detection_mapping" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "upload_ticket_target_idx" ON "upload_ticket" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "upload_ticket_owner_idx" ON "upload_ticket" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "upload_ticket_unused_expiry_idx" ON "upload_ticket" USING btree ("expires_at","id") WHERE "upload_ticket"."used_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "block_pair_idx" ON "block" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_deletion_object_idx" ON "storage_deletion" USING btree ("namespace","storage_key");--> statement-breakpoint
CREATE INDEX "storage_deletion_next_attempt_idx" ON "storage_deletion" USING btree ("next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "webhook_enabled_idx" ON "webhook" USING btree ("enabled") WHERE "webhook"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_dedup_idx" ON "webhook_delivery" USING btree ("webhook_id","dedup_key");--> statement-breakpoint
CREATE INDEX "webhook_delivery_clip_idx" ON "webhook_delivery" USING btree ("clip_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_pending_idx" ON "webhook_delivery" USING btree ("next_attempt_at","created_at") WHERE "webhook_delivery"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_account_idx" ON "auth_account" USING btree ("provider_id","provider_account_id");--> statement-breakpoint
CREATE INDEX "auth_challenge_user_idx" ON "auth_challenge" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_challenge_expires_at_idx" ON "auth_challenge" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_challenge_purpose_identifier_idx" ON "auth_challenge" USING btree ("purpose","identifier");--> statement-breakpoint
CREATE INDEX "auth_refresh_token_session_idx" ON "auth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "auth_refresh_token_expires_at_idx" ON "auth_refresh_token" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_lower_unique" ON "user" USING btree (lower("username"));