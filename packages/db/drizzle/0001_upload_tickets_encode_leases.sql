CREATE TABLE "clip_upload_ticket" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clip_id" uuid NOT NULL,
  "role" text NOT NULL,
  "storage_key" text NOT NULL,
  "content_type" text NOT NULL,
  "expected_bytes" bigint NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "clip_upload_ticket_storage_key_unique" UNIQUE("storage_key")
);

ALTER TABLE "clip_upload_ticket" ADD CONSTRAINT "clip_upload_ticket_clip_id_clip_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clip"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "clip_upload_ticket_clip_idx" ON "clip_upload_ticket" USING btree ("clip_id");
CREATE INDEX "clip_upload_ticket_expires_idx" ON "clip_upload_ticket" USING btree ("expires_at");
CREATE INDEX "clip_upload_ticket_used_idx" ON "clip_upload_ticket" USING btree ("used_at");

ALTER TABLE "clip" ADD COLUMN "encode_run_id" uuid;
ALTER TABLE "clip" ADD COLUMN "encode_locked_at" timestamp;
ALTER TABLE "clip" ADD COLUMN "encode_attempt" integer DEFAULT 0 NOT NULL;
