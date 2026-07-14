import { job, type JobStatus } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { and, eq, inArray, lt, ne, type SQL, sql } from "drizzle-orm"

import { publishJobEvent, publishQueueWake } from "./events"
import { rearmRecurringJob } from "./recurring"
import { getJobKind, requireJobKind } from "./registry"
import { leasedRunningJob } from "./store-database"
import type { JobTransaction } from "./store-types"

const jobEventSelect = {
  id: job.id,
  kind: job.kind,
  progress: job.progress,
  stage: job.stage,
} as const

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
