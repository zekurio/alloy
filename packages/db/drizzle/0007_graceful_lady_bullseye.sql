CREATE TABLE "clip_audio_track" (
	"clip_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"codecs" text NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clip_audio_track_clip_id_idx_pk" PRIMARY KEY("clip_id","idx"),
	CONSTRAINT "clip_audio_track_idx_check" CHECK ("clip_audio_track"."idx" >= 0 and "clip_audio_track"."idx" < 5),
	CONSTRAINT "clip_audio_track_kind_check" CHECK ("clip_audio_track"."kind" in ('game', 'microphone', 'desktop', 'application', 'other')),
	CONSTRAINT "clip_audio_track_label_check" CHECK (char_length("clip_audio_track"."label") between 1 and 64 and "clip_audio_track"."label" = btrim("clip_audio_track"."label")),
	CONSTRAINT "clip_audio_track_size_bytes_safe_check" CHECK ("clip_audio_track"."size_bytes" >= 0 and "clip_audio_track"."size_bytes" <= 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "pending_audio_tracks" jsonb;--> statement-breakpoint
ALTER TABLE "clip" ADD COLUMN "audio_track_fingerprint" text;--> statement-breakpoint
ALTER TABLE "clip_audio_track" ADD CONSTRAINT "clip_audio_track_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;