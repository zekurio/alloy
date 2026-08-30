import {
  ADMIN_JOB_QUEUES,
  ADMIN_SWEEP_KINDS,
  JOB_KINDS,
  type AdminFailedJob,
  type AdminJobOperations,
  type AdminJobQueueRow,
  type JobQueue,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import type { JobStatus } from "@alloy/db/schema"
import { client } from "@alloy/server/db/index"
import {
  cleanupExpiredStorageOrphanGcPreview,
  confirmStorageOrphanGcPreview,
  enqueueStorageOrphanGcPreview,
} from "@alloy/server/jobs/kinds/storage-orphan-gc"
import { getJobKind, registeredJobKinds } from "@alloy/server/jobs/registry"
import { discardFailed, jobCounts, retry } from "@alloy/server/jobs/store"
import { readJobOperationSummaries } from "@alloy/server/jobs/summaries"
import {
  CLIP_MEDIA_FAILURE_ID_PREFIX,
  clipIdFromMediaFailureId,
  legacyRenditionOperationCounts,
} from "@alloy/server/queue/clip-media-policy"
import {
  clipMediaAdminQueueCounts,
  discardClipMediaFailure,
  retryClipMediaFailure,
} from "@alloy/server/queue/clip-media-work-store"
import {
  forceReconcileClipMedia,
  reconcileClipMedia,
  wakeClipMediaWorker,
} from "@alloy/server/queue/clip-media-worker"
import { readMediaGeneration } from "@alloy/server/queue/media-generation"
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

const JobIdParam = t.object({ id: t.string().min(1) })
const UuidSchema = t.string().uuid()
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
    await cleanupExpiredStorageOrphanGcPreview()
    const [counts, summaries, mediaQueueCounts] = await Promise.all([
      jobCounts(),
      readJobOperationSummaries(),
      readMediaGeneration().then((generation) =>
        clipMediaAdminQueueCounts(generation?.generation ?? null),
      ),
    ])
    const queues = ADMIN_JOB_QUEUES.map((queue): AdminJobQueueRow =>
      queue === "encode"
        ? { queue, ...mediaQueueCounts }
        : { queue, ...countsForQueue(counts, queue) },
    )
    const operations: AdminJobOperations = {
      renditionSweep: {
        ...legacyRenditionOperationCounts(mediaQueueCounts),
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
    const generation = await readMediaGeneration()
    const page = await listFailedWork({
      kind: query.kind,
      cursor,
      generation: generation?.generation ?? null,
      limit: query.limit,
    })
    return c.json({
      items: page.rows.map(toFailedJob),
      nextCursor: page.cursor
        ? encodeCursorPayload({
            finishedAt: page.cursor.finishedAt,
            id: page.cursor.id,
          })
        : null,
    })
  })
  .post("/jobs/:id/retry", tbValidator("param", JobIdParam), async (c) => {
    const id = c.req.valid("param").id
    const mediaClipId = clipIdFromMediaFailureId(id)
    if (mediaClipId) {
      if (!(await retryClipMediaFailure(mediaClipId))) {
        return notFound(c, "No failed job to retry.")
      }
      wakeClipMediaWorker()
      return success(c)
    }
    const genericId = UuidSchema.safeParse(id)
    if (!genericId.success || !(await retry(genericId.data))) {
      return notFound(c, "No failed job to retry.")
    }
    return success(c)
  })
  .post("/jobs/:id/discard", tbValidator("param", JobIdParam), async (c) => {
    const id = c.req.valid("param").id
    const mediaClipId = clipIdFromMediaFailureId(id)
    if (mediaClipId) {
      const generation = await readMediaGeneration()
      if (
        !generation ||
        !(await discardClipMediaFailure(mediaClipId, generation.generation))
      ) {
        return notFound(c, "No failed job to discard.")
      }
      return success(c)
    }
    const genericId = UuidSchema.safeParse(id)
    if (!genericId.success || !(await discardFailed(genericId.data))) {
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
      if (c.req.valid("json").mode === "force") {
        await forceReconcileClipMedia()
      } else {
        await reconcileClipMedia()
      }
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

interface FailedWorkRow {
  id: string
  kind: string
  clip_id: string | null
  error: string | null
  attempt: number
  finished_at: Date | null
  finished_at_text: string | null
}

async function listFailedWork(options: {
  kind?: string
  cursor: { finishedAt: string; id: string } | null
  generation: number | null
  limit: number
}): Promise<{
  rows: FailedWorkRow[]
  cursor: { finishedAt: string; id: string } | null
}> {
  const result = await client.query<FailedWorkRow>(
    `
      with failed_work as (
        select
          j.id::text as id,
          j.kind,
          j.payload ->> 'clipId' as clip_id,
          j.error,
          j.attempt,
          j.finished_at
        from job j
        where j.status = 'failed'
          and j.kind = any($1::text[])

        union all

        select
          $2::text || c.id::text as id,
          'clip.encode'::text as kind,
          c.id::text as clip_id,
          c.failure_reason as error,
          c.encode_attempt as attempt,
          c.updated_at at time zone 'UTC' as finished_at
        from clip c
        where c.encode_request_id is null
          and c.encode_run_id is null
          and c.encode_failed_generation is not null
          and (
            $4::int is null
            or c.status = 'failed'
            or c.encode_failed_generation = $4::int
          )
      )
      select
        id,
        kind,
        clip_id,
        error,
        attempt,
        finished_at,
        finished_at::text as finished_at_text
      from failed_work
      where ($3::text is null or kind = $3::text)
        and (
          $5::timestamptz is null
          or finished_at < $5::timestamptz
          or (finished_at = $5::timestamptz and id < $6::text)
        )
      order by finished_at desc nulls last, id desc
      limit $7::int
    `,
    [
      [...JOB_KINDS],
      CLIP_MEDIA_FAILURE_ID_PREFIX,
      options.kind ?? null,
      options.generation,
      options.cursor?.finishedAt ?? null,
      options.cursor?.id ?? null,
      options.limit + 1,
    ],
  )
  const rows = result.rows.slice(0, options.limit)
  const last = rows.at(-1)
  return {
    rows,
    cursor:
      result.rows.length > options.limit && last?.finished_at_text
        ? { finishedAt: last.finished_at_text, id: last.id }
        : null,
  }
}

function decodeFailedCursor(
  value: string | undefined,
): { finishedAt: string; id: string } | null {
  const payload = decodeCursorPayload(value)
  if (!payload) return null
  // Both values are passed into typed SQL comparisons. The id is either a
  // generic UUID or the unambiguous synthetic clip-media id.
  const finishedAt = cursorTimestamptzText(payload.finishedAt)
  const id = t.string().safeParse(payload.id)
  if (!finishedAt || !id.success) return null
  const genericId = UuidSchema.safeParse(id.data)
  const mediaId = clipIdFromMediaFailureId(id.data)
  if (!genericId.success && !mediaId) return null
  return { finishedAt, id: id.data }
}

function toFailedJob(row: FailedWorkRow): AdminFailedJob {
  return {
    id: row.id,
    kind: row.kind,
    clipId: row.clip_id,
    error: row.error,
    attempt: row.attempt,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    retryable: getJobKind(row.kind)?.adminRetryable !== false,
  }
}
