-- The jobs dashboard and generic runtime are retired. Domain workers own
-- current media, upload, notification, and delivery work.
DROP TABLE "job";--> statement-breakpoint
DELETE FROM "instance_setting"
WHERE "key" IN ('renditionSweep', 'storageGc', 'storageGcConfirmation', 'storageGcManifest');
