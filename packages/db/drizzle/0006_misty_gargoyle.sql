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
CREATE UNIQUE INDEX "storage_deletion_object_idx" ON "storage_deletion" USING btree ("namespace","storage_key");--> statement-breakpoint
CREATE INDEX "storage_deletion_next_attempt_idx" ON "storage_deletion" USING btree ("next_attempt_at","created_at");
