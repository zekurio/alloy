UPDATE "clip"
SET
	"encode_run_id" = NULL,
	"encode_locked_at" = NULL
WHERE EXISTS (
	SELECT 1
	FROM "job"
	WHERE
		"job"."kind" = 'clip.encode'
		AND "job"."status" = 'running'
		AND "job"."payload" ->> 'trigger' IN ('reconcile', 'repair')
		AND "job"."lease_token" IS NOT NULL
		AND "clip"."encode_run_id" = "job"."lease_token"
);
--> statement-breakpoint
DELETE FROM "job"
WHERE
	"kind" IN ('clip.verify', 'clip.verify-assets', 'maintenance.run')
	OR (
		"kind" = 'clip.encode'
		AND "payload" ->> 'trigger' IN ('reconcile', 'repair')
	);
