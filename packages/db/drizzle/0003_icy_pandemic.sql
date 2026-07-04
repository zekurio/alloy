CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedup_key" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"progress" integer DEFAULT 0 NOT NULL,
	"stage" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_status_check" CHECK ("job"."status" in ('pending', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "job_progress_check" CHECK ("job"."progress" >= 0 and "job"."progress" <= 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_pending_dedup_idx" ON "job" USING btree ("kind","dedup_key") WHERE "job"."status" = 'pending' and "job"."dedup_key" is not null;--> statement-breakpoint
CREATE INDEX "job_pending_claim_idx" ON "job" USING btree ("kind","priority","run_at") WHERE "job"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "job_running_locked_idx" ON "job" USING btree ("locked_at") WHERE "job"."status" = 'running';--> statement-breakpoint
CREATE INDEX "job_kind_status_finished_idx" ON "job" USING btree ("kind","status","finished_at");