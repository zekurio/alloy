import {
  ADMIN_SWEEP_KINDS,
  type AdminFailedJob,
  type AdminJobKindRow,
  type AdminSweepKind,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import type { JobStatus } from "@alloy/db/schema"
import { configStore } from "@alloy/server/config/store"
import { enqueueRenditionsSweep } from "@alloy/server/jobs/kinds/renditions-sweep"
import { enqueueStorageOrphanGc } from "@alloy/server/jobs/kinds/storage-orphan-gc"
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
const FailedQuery = t.object({
  kind: t.string().min(1).optional(),
  cursor: t.string().optional(),
  limit: t.coerce.number().int().min(1).max(100).$default(20),
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
  .post(
    "/jobs/sweeps/:kind",
    tbValidator("param", KindParam),
    tbValidator("json", SweepBody),
    async (c) => {
      const kind = c.req.valid("param").kind
      if (!SWEEP_KINDS.has(kind)) return badRequest(c, "Unknown sweep.")
      await runSweep(kind as AdminSweepKind, c.req.valid("json").mode)
      return success(c)
    },
  )
  .post("/jobs/kinds/:kind/pause", tbValidator("param", KindParam), async (c) =>
    setPaused(c, c.req.valid("param").kind, true),
  )
  .post(
    "/jobs/kinds/:kind/resume",
    tbValidator("param", KindParam),
    async (c) => setPaused(c, c.req.valid("param").kind, false),
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
    pausedKinds: [...current].sort((a, b) => a.localeCompare(b)),
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
  }
}

function payloadClipId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const clipId = (payload as Record<string, unknown>).clipId
  return typeof clipId === "string" ? clipId : null
}
