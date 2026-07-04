import {
  ADMIN_SWEEP_KINDS,
  type AdminFailedJob,
  type AdminJobKindRow,
  type AdminSweepKind,
} from "@alloy/contracts"
import type { JobStatus } from "@alloy/db/schema"
import { configStore } from "@alloy/server/config/store"
import { enqueueRenditionsSweep } from "@alloy/server/jobs/kinds/renditions-sweep"
import {
  enqueueStorageOrphanGc,
  enqueueStorageVerify,
} from "@alloy/server/jobs/kinds/storage-verify"
import { enqueueThumbnailSweep } from "@alloy/server/jobs/kinds/thumbnail-sweep"
import { registeredJobKinds } from "@alloy/server/jobs/registry"
import {
  discardFailed,
  jobCounts,
  listJobs,
  nextPendingRunByKind,
  retry,
  wakeQueueForKind,
} from "@alloy/server/jobs/store"
import { readJobSweeps } from "@alloy/server/jobs/summaries"
import {
  badRequest,
  notFound,
  success,
} from "@alloy/server/runtime/http-response"
import { type Context, Hono } from "hono"
import { z } from "zod"

import {
  cursorTimestamptzText,
  decodeCursorPayload,
  encodeCursorPayload,
} from "./cursor-codec"
import { zValidator } from "./validation"

const JobIdParam = z.object({ id: z.string().uuid() })
const KindParam = z.object({ kind: z.string().min(1) })
const SweepBody = z.object({
  mode: z.enum(["stale", "force"]).default("stale"),
})
const FailedQuery = z.object({
  kind: z.string().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const SWEEP_KINDS: ReadonlySet<string> = new Set(ADMIN_SWEEP_KINDS)

export const adminJobsRoute = new Hono()
  .get("/jobs/summary", async (c) => {
    const [counts, nextRuns, sweeps] = await Promise.all([
      jobCounts(),
      nextPendingRunByKind(),
      readJobSweeps(),
    ])
    const paused = new Set(configStore.get("jobs").pausedKinds)
    const kinds = registeredJobKinds()
      .map((registration): AdminJobKindRow => {
        const forKind = counts.filter((row) => row.kind === registration.kind)
        const nextRunAt = nextRuns.get(registration.kind)
        return {
          kind: registration.kind,
          queue: registration.queue,
          pending: countFor(forKind, "pending"),
          running: countFor(forKind, "running"),
          failed: countFor(forKind, "failed"),
          completed: countFor(forKind, "completed"),
          paused: paused.has(registration.kind),
          ...(registration.schedule
            ? {
                schedule: {
                  everyMs: registration.schedule.everyMs,
                  nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
                },
              }
            : {}),
        }
      })
      .sort((a, b) => a.kind.localeCompare(b.kind))
    return c.json({ kinds, sweeps })
  })
  .get("/jobs/failed", zValidator("query", FailedQuery), async (c) => {
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
  .post("/jobs/:id/retry", zValidator("param", JobIdParam), async (c) => {
    if (!(await retry(c.req.valid("param").id))) {
      return notFound(c, "No failed job to retry.")
    }
    return success(c)
  })
  .post("/jobs/:id/discard", zValidator("param", JobIdParam), async (c) => {
    if (!(await discardFailed(c.req.valid("param").id))) {
      return notFound(c, "No failed job to discard.")
    }
    return success(c)
  })
  .post(
    "/jobs/sweeps/:kind",
    zValidator("param", KindParam),
    zValidator("json", SweepBody),
    async (c) => {
      const kind = c.req.valid("param").kind
      if (!SWEEP_KINDS.has(kind)) return badRequest(c, "Unknown sweep.")
      await runSweep(kind as AdminSweepKind, c.req.valid("json").mode)
      return success(c)
    },
  )
  .post("/jobs/kinds/:kind/pause", zValidator("param", KindParam), async (c) =>
    setPaused(c, c.req.valid("param").kind, true),
  )
  .post("/jobs/kinds/:kind/resume", zValidator("param", KindParam), async (c) =>
    setPaused(c, c.req.valid("param").kind, false),
  )

function countFor(
  rows: { status: JobStatus; count: number }[],
  status: JobStatus,
): number {
  return rows.find((row) => row.status === status)?.count ?? 0
}

function runSweep(
  kind: AdminSweepKind,
  mode: "stale" | "force",
): Promise<string> {
  const runAt = new Date()
  if (kind === "clip.renditions-sweep") {
    return enqueueRenditionsSweep(mode, { runAt })
  }
  if (kind === "clip.thumbnail-sweep") {
    return enqueueThumbnailSweep(mode, { runAt })
  }
  if (kind === "clip.verify-assets") return enqueueStorageVerify({ runAt })
  return enqueueStorageOrphanGc({ runAt })
}

async function setPaused(c: Context, kind: string, paused: boolean) {
  if (
    !registeredJobKinds().some((registration) => registration.kind === kind)
  ) {
    return badRequest(c, "Unknown job kind.")
  }
  const current = new Set(configStore.get("jobs").pausedKinds)
  if (paused) current.add(kind)
  else current.delete(kind)
  await configStore.set("jobs", {
    ...configStore.get("jobs"),
    pausedKinds: [...current].sort(),
  })
  // Resuming should let a queued job start without waiting for the fallback
  // poll; pausing takes effect on the dispatcher's next claim regardless.
  if (!paused) wakeQueueForKind(kind)
  return success(c)
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
  const id = z.string().uuid().safeParse(payload.id)
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
  }
}

function payloadClipId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const clipId = (payload as Record<string, unknown>).clipId
  return typeof clipId === "string" ? clipId : null
}
