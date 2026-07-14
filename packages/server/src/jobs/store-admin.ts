import { job, type JobStatus } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { and, count, desc, eq, getTableColumns, lt, or, sql } from "drizzle-orm"

import type { ListedJobs, ListJobsOptions } from "./store-types"

export async function jobCounts(): Promise<
  Array<{ kind: string; status: JobStatus; count: number }>
> {
  return db
    .select({ kind: job.kind, status: job.status, count: count() })
    .from(job)
    .groupBy(job.kind, job.status)
}

export async function nextPendingRunByKind(): Promise<Map<string, Date>> {
  const rows = await db
    .select({
      // mapWith applies the column's driver mapping — a bare sql aggregate
      // would return the timestamptz as a string despite the Date annotation.
      runAt: sql`min(${job.run_at})`.mapWith(job.run_at),
      kind: job.kind,
    })
    .from(job)
    .where(eq(job.status, "pending"))
    .groupBy(job.kind)
  return new Map(rows.map((row) => [row.kind, row.runAt]))
}

// Dismisses a terminally failed job from the admin failed list. Deletes the row
// rather than cancelling it: the failed row carries no clip state (quarantine
// lives on clip.encode_failed_fingerprint), so removing it clears the dashboard
// entry without ever un-quarantining the clip.
export async function discardFailed(jobId: string): Promise<boolean> {
  const [row] = await db
    .delete(job)
    .where(and(eq(job.id, jobId), eq(job.status, "failed")))
    .returning({ id: job.id })
  return Boolean(row)
}

export async function listJobs(options: ListJobsOptions): Promise<ListedJobs> {
  const rows = await db
    .select({
      job: getTableColumns(job),
      // µs-precision text for the pagination cursor; the Date-mapped column
      // would truncate to ms and skip same-ms rows across the page boundary.
      finishedAtText: sql<string | null>`${job.finished_at}::text`,
    })
    .from(job)
    .where(listJobsWhere(options))
    .orderBy(desc(job.finished_at), desc(job.id))
    .limit(options.limit + 1)
  const page = rows.slice(0, options.limit)
  const last = page.at(-1)
  return {
    jobs: page.map((row) => row.job),
    cursor:
      rows.length > options.limit && last?.finishedAtText
        ? { finishedAt: last.finishedAtText, id: last.job.id }
        : null,
  }
}

export async function prune(
  completedBefore: Date,
  failedBefore: Date,
): Promise<number> {
  const rows = await db
    .delete(job)
    .where(
      or(
        and(eq(job.status, "completed"), lt(job.finished_at, completedBefore)),
        and(eq(job.status, "failed"), lt(job.finished_at, failedBefore)),
      ),
    )
    .returning({ id: job.id })
  return rows.length
}

function listJobsWhere(options: ListJobsOptions) {
  const filters = [
    options.kind ? eq(job.kind, options.kind) : undefined,
    options.status ? eq(job.status, options.status) : undefined,
    options.cursor
      ? or(
          lt(job.finished_at, sql`${options.cursor.finishedAt}::timestamptz`),
          and(
            eq(job.finished_at, sql`${options.cursor.finishedAt}::timestamptz`),
            lt(job.id, options.cursor.id),
          ),
        )
      : undefined,
  ].filter((filter) => filter !== undefined)
  if (filters.length === 0) return undefined
  return and(...filters)
}
