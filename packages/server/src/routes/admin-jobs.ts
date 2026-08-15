import {
  ADMIN_SWEEP_KINDS,
  JOB_QUEUES,
  type AdminFailedJob,
  type AdminJobOperations,
  type AdminJobQueueRow,
  type JobQueue,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import type { JobStatus } from "@alloy/db/schema"
import { enqueueRenditionsSweep } from "@alloy/server/jobs/kinds/renditions-sweep"
import {
  confirmStorageOrphanGcPreview,
  enqueueStorageOrphanGcPreview,
} from "@alloy/server/jobs/kinds/storage-orphan-gc"
import { getJobKind, registeredJobKinds } from "@alloy/server/jobs/registry"
import {
  discardFailed,
  jobCounts,
  listJobs,
  retry,
} from "@alloy/server/jobs/store"
import { readJobOperationSummaries } from "@alloy/server/jobs/summaries"
import {
  badRequest,
  conflict,
  notFound,
  success,
} from "@alloy/server/runtime/http-response"
import { Hono } from "hono"

import {
  cursorTimestamptzText,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"
import { tbValidator } from "./validation"

const JobIdParam = t.object({ id: t.string().uuid() })
const KindParam = t.object({ kind: t.string().min(1) })
const SweepBody = t.object({
  mode: t.enum(["stale", "force"]).$default("stale"),
})
const StorageGcConfirmBody = t.object({ previewJobId: t.string().uuid() })
const FailedQuery = t.object({
  kind: t.string().min(1).optional(),
  cursor: t.string().optional(),
  limit: t.coerce.number().int().min(1).max(100).$default(20),
})

const SWEEP_KINDS: ReadonlySet<string> = new Set(ADMIN_SWEEP_KINDS)

export const adminJobsRoute = new Hono()
  .get("/jobs/summary", async (c) => {
    const [counts, summaries] = await Promise.all([
      jobCounts(),
      readJobOperationSummaries(),
    ])
    const queues = JOB_QUEUES.map((queue): AdminJobQueueRow => ({
      queue,
      ...countsForQueue(counts, queue),
    }))
    const operations: AdminJobOperations = {
      renditionSweep: {
        ...countsForKind(counts, "clip.renditions-sweep"),
        summary: summaries.renditionSweep,
      },
      storageGc: {
        ...countsForKind(counts, "storage.orphan-gc"),
        summary: summaries.storageGc,
      },
    }
    return c.json({ queues, operations })
  })
  .get("/jobs/failed", tbValidator("query", FailedQuery), async (c) => {
    const query = c.req.valid("query")
    const cursor = decodeFailedCursor(query.cursor)
    const page = await listJobs({
      status: "failed" satisfies JobStatus,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit,
    })
    return c.json({
      items: page.jobs.map(toFailedJob),
      nextCursor: page.cursor
        ? encodeCursorPayload({
            finishedAt: page.cursor.finishedAt,
            id: page.cursor.id,
          })
        : null,
    })
  })
  .post("/jobs/:id/retry", tbValidator("param", JobIdParam), async (c) => {
    if (!(await retry(c.req.valid("param").id))) {
      return notFound(c, "No failed job to retry.")
    }
    return success(c)
  })
  .post("/jobs/:id/discard", tbValidator("param", JobIdParam), async (c) => {
    if (!(await discardFailed(c.req.valid("param").id))) {
      return notFound(c, "No failed job to discard.")
    }
    return success(c)
  })
  .post("/jobs/sweeps/storage.orphan-gc/preview", async (c) => {
    const jobId = await enqueueStorageOrphanGcPreview()
    if (!jobId) {
      return conflict(c, "Wait for the current storage cleanup to finish.")
    }
    return c.json({ jobId })
  })
  .post(
    "/jobs/sweeps/storage.orphan-gc/confirm",
    tbValidator("json", StorageGcConfirmBody),
    async (c) => {
      const jobId = await confirmStorageOrphanGcPreview(
        c.req.valid("json").previewJobId,
      )
      if (!jobId) {
        return conflict(c, "Run a new storage cleanup preview.")
      }
      return c.json({ jobId })
    },
  )
  .post(
    "/jobs/sweeps/:kind",
    tbValidator("param", KindParam),
    tbValidator("json", SweepBody),
    async (c) => {
      const kind = c.req.valid("param").kind
      if (!SWEEP_KINDS.has(kind)) return badRequest(c, "Unknown sweep.")
      await enqueueRenditionsSweep(c.req.valid("json").mode, {
        runAt: new Date(),
      })
      return success(c)
    },
  )

function countFor(
  rows: { status: JobStatus; count: number }[],
  status: JobStatus,
): number {
  return rows.find((row) => row.status === status)?.count ?? 0
}

function countsForKind(
  counts: { kind: string; status: JobStatus; count: number }[],
  kind: string,
) {
  const rows = counts.filter((row) => row.kind === kind)
  return {
    pending: countFor(rows, "pending"),
    running: countFor(rows, "running"),
    failed: countFor(rows, "failed"),
    completed: countFor(rows, "completed"),
  }
}

function countsForQueue(
  counts: { kind: string; status: JobStatus; count: number }[],
  queue: JobQueue,
) {
  const kinds: ReadonlySet<string> = new Set(
    registeredJobKinds()
      .filter((registration) => registration.queue === queue)
      .map((registration) => registration.kind),
  )
  const rows = counts.filter((row) => kinds.has(row.kind))
  return {
    pending: sumFor(rows, "pending"),
    running: sumFor(rows, "running"),
    failed: sumFor(rows, "failed"),
    completed: sumFor(rows, "completed"),
  }
}

function sumFor(
  rows: { status: JobStatus; count: number }[],
  status: JobStatus,
): number {
  return rows
    .filter((row) => row.status === status)
    .reduce((sum, row) => sum + row.count, 0)
}

function decodeFailedCursor(
  value: string | undefined,
): { finishedAt: string; id: string } | null {
  const payload = decodeCursorPayload(value)
  if (!payload) return null
  // finishedAt is passed straight back into a ::timestamptz cast, and id into a
  // uuid comparison — a crafted cursor with a non-timestamp/non-uuid would raise
  // a DB error, so validate both here and ignore anything malformed.
  const finishedAt = cursorTimestamptzText(payload.finishedAt)
  const id = t.string().uuid().safeParse(payload.id)
  if (!finishedAt || !id.success) return null
  return { finishedAt, id: id.data }
}

function toFailedJob(row: {
  id: string
  kind: string
  payload: unknown
  error: string | null
  attempt: number
  finished_at: Date | null
}): AdminFailedJob {
  return {
    id: row.id,
    kind: row.kind,
    clipId: payloadClipId(row.payload),
    error: row.error,
    attempt: row.attempt,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    retryable: getJobKind(row.kind)?.adminRetryable !== false,
  }
}

function payloadClipId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const clipId = (payload as Record<string, unknown>).clipId
  return typeof clipId === "string" ? clipId : null
}
