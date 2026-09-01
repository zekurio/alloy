UPDATE "clip"
SET
	"encode_fingerprint" = CASE
		WHEN "encode_fingerprint" IS NULL THEN NULL
		WHEN "encode_fingerprint" ~ '^\{"p":"[0-9]+",' THEN regexp_replace("encode_fingerprint", '^\{"p":"[0-9]+",', '{')
		ELSE NULL
	END,
	"encode_failed_fingerprint" = CASE
		WHEN "encode_failed_fingerprint" IS NULL THEN NULL
		WHEN "encode_failed_fingerprint" ~ '^\{"p":"[0-9]+",' THEN regexp_replace("encode_failed_fingerprint", '^\{"p":"[0-9]+",', '{')
		ELSE NULL
	END;
--> statement-breakpoint
ALTER TABLE "clip" DROP COLUMN "encode_pipeline";
