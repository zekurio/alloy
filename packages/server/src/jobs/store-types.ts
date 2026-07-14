import type { Job, JobStatus } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"

export interface EnqueueOptions {
  priority?: number
  runAt?: Date
  dedupKey?: string
  tx?: JobTransaction
}

export interface ClaimedJob {
  id: string
  kind: string
  payload: unknown
  status: JobStatus
  priority: number
  run_at: Date
  dedup_key: string | null
  attempt: number
  lease_token: string | null
  locked_at: Date | null
  started_at: Date | null
  finished_at: Date | null
  progress: number
  stage: string | null
  error: string | null
  created_at: Date
  updated_at: Date
}

export interface ListJobsOptions {
  kind?: string
  status?: JobStatus
  // finishedAt is the raw Postgres timestamptz text (µs precision). A JS Date
  // truncates to ms, which drops same-millisecond boundary rows on the next
  // page, so the cursor round-trips the string and casts back to timestamptz.
  cursor?: {
    finishedAt: string
    id: string
  }
  limit: number
}

export interface ListedJobs {
  jobs: Job[]
  cursor: ListJobsOptions["cursor"] | null
}

export type JobTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
