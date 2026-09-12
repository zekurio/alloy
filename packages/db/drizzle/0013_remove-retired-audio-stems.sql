-- Retire derived stems through the deletion ledger before dropping their references.
INSERT INTO "storage_deletion" ("namespace", "storage_key", "reason", "source_type", "source_id")
SELECT 'clips', "storage_key", 'retired audio stem', 'schema-migration', '0013'
FROM "clip_audio_track"
ON CONFLICT ("namespace", "storage_key") DO NOTHING;
--> statement-breakpoint
DROP TABLE "clip_audio_track" CASCADE;--> statement-breakpoint
ALTER TABLE "clip" DROP COLUMN "pending_audio_tracks";--> statement-breakpoint
ALTER TABLE "clip" DROP COLUMN "audio_track_fingerprint";