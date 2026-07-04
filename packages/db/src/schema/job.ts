import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { sqlStringList } from "./internal"

export const JOB_STATUS = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const

export type JobStatus = (typeof JOB_STATUS)[number]

export const job = pgTable(
  "job",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    payload: jsonb()
      .$type<unknown>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text().$type<JobStatus>().notNull().default("pending"),
    priority: integer().notNull().default(50),
    // timestamptz throughout: these columns are compared against now() and
    // written from JS Dates; without-tz columns skew by the server offset.
    run_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    dedup_key: text(),
    attempt: integer().notNull().default(0),
    lease_token: uuid(),
    locked_at: timestamp({ withTimezone: true }),
    started_at: timestamp({ withTimezone: true }),
    finished_at: timestamp({ withTimezone: true }),
    progress: integer().notNull().default(0),
    stage: text(),
    error: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_pending_dedup_idx")
      .on(t.kind, t.dedup_key)
      .where(sql`${t.status} = 'pending' and ${t.dedup_key} is not null`),
    index("job_pending_claim_idx")
      .on(t.kind, t.priority, t.run_at)
      .where(sql`${t.status} = 'pending'`),
    index("job_running_locked_idx")
      .on(t.locked_at)
      .where(sql`${t.status} = 'running'`),
    index("job_kind_status_finished_idx").on(t.kind, t.status, t.finished_at),
    check(
      "job_status_check",
      sql`${t.status} in (${sql.raw(sqlStringList(JOB_STATUS))})`,
    ),
    check(
      "job_progress_check",
      sql`${t.progress} >= 0 and ${t.progress} <= 100`,
    ),
  ],
)

export type Job = typeof job.$inferSelect
