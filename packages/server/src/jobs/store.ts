import { job, type Job, type JobStatus } from "@alloy/db/schema"
import { db, client } from "@alloy/server/db/index"
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import { publishJobEvent, publishQueueWake } from "./events"
import { rearmRecurringJob } from "./recurring"
import { getJobKind, requireJobKind } from "./registry"

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

const jobEventSelect = {
  id: job.id,
  kind: job.kind,
  progress: job.progress,
  stage: job.stage,
} as const

export async function enqueue(
  kind: string,
  payload: unknown,
  options: EnqueueOptions = {},
): Promise<string> {
  const registration = requireJobKind(kind)
  const parsed = registration.schema.parse(payload)
  const executor = options.tx ?? db
  const [row] = await executor
    .insert(job)
    .values({
      kind,
      payload: parsed,
      priority: options.priority ?? registration.defaultPriority,
      run_at: options.runAt ?? sql`now()`,
      dedup_key: options.dedupKey,
    })
    .onConflictDoUpdate({
      target: [job.kind, job.dedup_key],
      targetWhere: pendingDedupPredicate(),
      setWhere: pendingDedupPredicate(),
      set: {
        payload: sql`excluded.payload`,
        priority: sql`least(${job.priority}, excluded.priority)`,
        run_at: sql`least(${job.run_at}, excluded.run_at)`,
        updated_at: sql`now()`,
      },
    })
    .returning({ id: job.id })
  if (!row) throw new Error(`Could not enqueue job "${kind}".`)
  if (options.tx) return row.id
  publishQueueWake(registration.queue)
  return row.id
}

export function wakeQueueForKind(kind: string): void {
  publishQueueWake(requireJobKind(kind).queue)
}

export async function hasLiveJob(
  kind: string,
  dedupKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.kind, kind),
        eq(job.dedup_key, dedupKey),
        inArray(job.status, ["pending", "running"]),
      ),
    )
    .limit(1)
  return Boolean(row)
}

export async function claim(
  kinds: string[],
  leaseToken: string,
): Promise<ClaimedJob | null> {
  if (kinds.length === 0) return null
  for (;;) {
    const row = await claimRaw(kinds, leaseToken)
    if (!row) return null

    const registration = getJobKind(row.kind)
    if (!registration) {
      await markClaimedFailed(row.id, leaseToken, "unknown job kind")
      continue
    }

    const parsed = registration.schema.safeParse(row.payload)
    if (!parsed.success) {
      await markClaimedFailed(
        row.id,
        leaseToken,
        `invalid job payload: ${z.prettifyError(parsed.error)}`,
      )
      continue
    }

    return { ...row, payload: parsed.data }
  }
}

export async function heartbeat(
  id: string,
  leaseToken: string,
): Promise<boolean> {
  const [row] = await db
    .update(job)
    .set({ locked_at: sql`now()`, updated_at: sql`now()` })
    .where(leasedRunningJob(id, leaseToken))
    .returning({ id: job.id })
  return Boolean(row)
}

export async function complete(
  id: string,
  leaseToken: string,
): Promise<boolean> {
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(job)
      .set({
        status: "completed",
        progress: 100,
        lease_token: null,
        locked_at: null,
        finished_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where(leasedRunningJob(id, leaseToken))
      .returning(jobEventSelect)
    if (!row) return null
    const registration = getJobKind(row.kind)
    if (registration) await rearmRecurringJob(tx, registration)
    return row
  })
  if (!updated) return false
  publishJobStatus(updated, "completed")
  return true
}

export async function fail(
  id: string,
  leaseToken: string,
  error: string,
  retryable: boolean,
): Promise<{ changed: boolean; willRetry: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: job.id,
        kind: job.kind,
        attempt: job.attempt,
        payload: job.payload,
        dedup_key: job.dedup_key,
        progress: job.progress,
        stage: job.stage,
      })
      .from(job)
      .where(leasedRunningJob(id, leaseToken))
      .limit(1)
    if (!row) return { changed: false, willRetry: false, row: null }

    const registration = getJobKind(row.kind)
    const willRetry =
      registration !== undefined &&
      retryable &&
      row.attempt < registration.retry.maxAttempts

    if (willRetry) {
      const pendingFields = await absorbPendingTwin(tx, row, {
        runAt: sql`now() + ${
          registration.retry.backoffMs * row.attempt
        } * interval '1 millisecond'`,
      })
      const [updated] = await tx
        .update(job)
        .set({
          status: "pending",
          ...pendingFields,
          lease_token: null,
          locked_at: null,
          error,
          updated_at: sql`now()`,
        })
        .where(leasedRunningJob(id, leaseToken))
        .returning({ id: job.id })
      return { changed: Boolean(updated), willRetry, row }
    }

    const [updated] = await tx
      .update(job)
      .set({
        status: "failed",
        lease_token: null,
        locked_at: null,
        finished_at: sql`now()`,
        error,
        updated_at: sql`now()`,
      })
      .where(leasedRunningJob(id, leaseToken))
      .returning({ id: job.id })
    if (updated && registration) await rearmRecurringJob(tx, registration)
    return { changed: Boolean(updated), willRetry: false, row }
  })

  if (!result.changed || !result.row) {
    return { changed: result.changed, willRetry: result.willRetry }
  }
  publishJobStatus(result.row, result.willRetry ? "pending" : "failed")
  if (result.willRetry) publishQueueWake(requireJobKind(result.row.kind).queue)
  return { changed: result.changed, willRetry: result.willRetry }
}

export async function cancel(id: string): Promise<boolean> {
  const [row] = await db
    .update(job)
    .set({
      status: "cancelled",
      lease_token: null,
      locked_at: null,
      finished_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where(and(eq(job.id, id), inArray(job.status, ["pending", "running"])))
    .returning(jobEventSelect)
  if (!row) return false
  publishJobStatus(row, "cancelled")
  return true
}

export async function cancelByKindDedup(
  kind: string,
  dedupKey: string,
): Promise<number> {
  const rows = await db
    .update(job)
    .set({
      status: "cancelled",
      lease_token: null,
      locked_at: null,
      finished_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(job.kind, kind),
        eq(job.dedup_key, dedupKey),
        inArray(job.status, ["pending", "running"]),
      ),
    )
    .returning(jobEventSelect)
  for (const row of rows) {
    publishJobStatus(row, "cancelled")
  }
  return rows.length
}

export async function retry(jobId: string): Promise<boolean> {
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: job.id,
        kind: job.kind,
        dedup_key: job.dedup_key,
        payload: job.payload,
      })
      .from(job)
      .where(and(eq(job.id, jobId), eq(job.status, "failed")))
      .limit(1)
    if (!current) return null
    const pendingFields = await absorbPendingTwin(tx, current, {
      priority: 10,
      runAt: sql`now()`,
    })
    const [updated] = await tx
      .update(job)
      .set({
        status: "pending",
        attempt: 0,
        ...pendingFields,
        lease_token: null,
        locked_at: null,
        started_at: null,
        finished_at: null,
        progress: 0,
        stage: null,
        error: null,
        updated_at: sql`now()`,
      })
      .where(and(eq(job.id, jobId), eq(job.status, "failed")))
      .returning(jobEventSelect)
    if (!updated) return null
    return { ...updated, payload: current.payload }
  })
  if (!row) return false
  const registration = getJobKind(row.kind)
  if (registration?.onRetry) {
    const parsed = registration.schema.safeParse(row.payload)
    // A payload that no longer parses can't be re-run meaningfully; the job is
    // still re-armed, but skip the side-state restore rather than throw.
    if (parsed.success) await registration.onRetry(parsed.data)
  }
  publishJobStatus(row, "pending")
  if (registration) publishQueueWake(registration.queue)
  return true
}

export async function snooze(
  id: string,
  leaseToken: string,
  runAt: Date,
): Promise<boolean> {
  const row = await db.transaction(async (tx) => {
    const current = await selectLeasedJobForPending(tx, id, leaseToken)
    if (!current) return null
    return moveLeasedJobToPending(tx, current, leaseToken, {
      runAt,
      attempt: sql`greatest(${job.attempt} - 1, 0)`,
    })
  })
  if (!row) return false
  publishJobStatus(row, "pending")
  publishQueueWake(requireJobKind(row.kind).queue)
  return true
}

export async function setProgress(
  id: string,
  leaseToken: string,
  pct: number,
  stage?: string,
): Promise<boolean> {
  const [row] = await db
    .update(job)
    .set(
      stage === undefined
        ? { progress: pct, updated_at: sql`now()` }
        : { progress: pct, stage, updated_at: sql`now()` },
    )
    .where(
      and(
        eq(job.id, id),
        eq(job.lease_token, leaseToken),
        eq(job.status, "running"),
        lt(job.progress, pct),
      ),
    )
    .returning(jobEventSelect)
  if (!row) return false
  publishJobStatus(row, "running")
  return true
}

export async function releaseForShutdown(
  id: string,
  leaseToken: string,
): Promise<boolean> {
  const row = await db.transaction(async (tx) => {
    const current = await selectLeasedJobForPending(tx, id, leaseToken)
    if (!current) return null
    return moveLeasedJobToPending(tx, current, leaseToken, {
      runAt: sql`now()`,
    })
  })
  if (!row) return false
  publishJobStatus(row, "pending")
  return true
}

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

async function claimRaw(
  kinds: string[],
  leaseToken: string,
): Promise<ClaimedJob | null> {
  const kindPlaceholders = kinds.map((_, index) => `$${index + 1}`).join(", ")
  const leaseTokenPlaceholder = `$${kinds.length + 1}`
  const result = await client.query<ClaimedJob>(
    `
      with candidate as (
        select j.id
        from job j
        where j.kind in (${kindPlaceholders})
          and (
            (j.status = 'pending' and j.run_at <= now())
            or (
              j.status = 'running'
              and j.locked_at < now() - interval '2 minutes'
            )
          )
          and not (
            j.status = 'pending'
            and j.dedup_key = j.kind
            and exists (
              select 1
              from job running
              where running.kind = j.kind
                and running.dedup_key = j.dedup_key
                and running.status = 'running'
                and running.locked_at >= now() - interval '2 minutes'
            )
          )
        order by j.priority asc, j.run_at asc, j.id asc
        limit 1
        for update skip locked
      )
      update job
      set
        status = 'running',
        lease_token = ${leaseTokenPlaceholder}::uuid,
        locked_at = now(),
        started_at = now(),
        attempt = attempt + 1,
        updated_at = now()
      from candidate
      where job.id = candidate.id
      returning
        job.id,
        job.kind,
        job.payload,
        job.status,
        job.priority,
        job.run_at,
        job.dedup_key,
        job.attempt,
        job.lease_token,
        job.locked_at,
        job.started_at,
        job.finished_at,
        job.progress,
        job.stage,
        job.error,
        job.created_at,
        job.updated_at
    `,
    [...kinds, leaseToken],
  )
  return result.rows[0] ?? null
}

async function markClaimedFailed(
  id: string,
  leaseToken: string,
  message: string,
): Promise<boolean> {
  const result = await fail(id, leaseToken, message, false)
  return result.changed
}

function leasedRunningJob(id: string, leaseToken: string) {
  return and(
    eq(job.id, id),
    eq(job.lease_token, leaseToken),
    eq(job.status, "running"),
  )
}

function publishJobStatus(
  row: { id: string; kind: string; progress: number; stage: string | null },
  status: JobStatus,
): void {
  publishJobEvent({
    jobId: row.id,
    kind: row.kind,
    status,
    progress: row.progress,
    stage: row.stage,
  })
}

async function selectLeasedJobForPending(
  tx: JobTransaction,
  id: string,
  leaseToken: string,
) {
  const [row] = await tx
    .select({
      id: job.id,
      kind: job.kind,
      dedup_key: job.dedup_key,
    })
    .from(job)
    .where(leasedRunningJob(id, leaseToken))
    .limit(1)
  return row ?? null
}

async function moveLeasedJobToPending(
  tx: JobTransaction,
  row: { id: string; kind: string; dedup_key: string | null },
  leaseToken: string,
  input: { runAt: Date | SQL; attempt?: SQL },
) {
  const pendingFields = await absorbPendingTwin(tx, row, { runAt: input.runAt })
  const [updated] = await tx
    .update(job)
    .set(
      input.attempt === undefined
        ? {
            status: "pending",
            ...pendingFields,
            lease_token: null,
            locked_at: null,
            updated_at: sql`now()`,
          }
        : {
            status: "pending",
            ...pendingFields,
            attempt: input.attempt,
            lease_token: null,
            locked_at: null,
            updated_at: sql`now()`,
          },
    )
    .where(leasedRunningJob(row.id, leaseToken))
    .returning(jobEventSelect)
  return updated ?? null
}

function pendingDedupPredicate() {
  return sql`${job.status} = 'pending' and ${job.dedup_key} is not null`
}

async function absorbPendingTwin(
  tx: JobTransaction,
  row: { id: string; kind: string; dedup_key: string | null },
  input: { priority?: number | SQL; runAt: Date | SQL },
): Promise<{ priority?: number | SQL; run_at: Date | SQL }> {
  if (!row.dedup_key) return pendingFields(input)
  const [twin] = await tx
    .delete(job)
    .where(
      and(
        ne(job.id, row.id),
        eq(job.kind, row.kind),
        eq(job.dedup_key, row.dedup_key),
        eq(job.status, "pending"),
      ),
    )
    .returning({
      priority: job.priority,
      run_at: job.run_at,
    })
  if (!twin) return pendingFields(input)
  // Explicit casts: least() over two bare parameters gives Postgres no type
  // context and fails with "expression is of type text".
  return {
    priority:
      input.priority === undefined
        ? sql`least(${job.priority}, ${twin.priority}::int)`
        : sql`least(${input.priority}::int, ${twin.priority}::int)`,
    run_at: sql`least(${input.runAt}::timestamptz, ${twin.run_at}::timestamptz)`,
  }
}

function pendingFields(input: { priority?: number | SQL; runAt: Date | SQL }): {
  priority?: number | SQL
  run_at: Date | SQL
} {
  if (input.priority === undefined) return { run_at: input.runAt }
  return { priority: input.priority, run_at: input.runAt }
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
