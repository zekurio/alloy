import { authChallenge } from "@alloy/db/auth-schema"
import { clip, job, uploadTicket } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { publishClipRemove } from "@alloy/server/clips/events"
import { configStore } from "@alloy/server/config/store"
import { client, db } from "@alloy/server/db/index"
import { deleteStagedUpload } from "@alloy/server/uploads/staged"
import { cleanupTickets } from "@alloy/server/uploads/tickets"
import { and, eq, isNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"

import { defineJobKind } from "../registry"
import { prune } from "../store"
import { enqueueClipEncode } from "./clip-encode"

const logger = createLogger("jobs")

const EVERY_5_MINUTES_MS = 5 * 60 * 1000
const EVERY_10_MINUTES_MS = 10 * 60 * 1000
const EVERY_DAY_MS = 24 * 60 * 60 * 1000

const EmptyPayloadSchema = z.object({}).default({})

defineJobKind({
  kind: "clip.reap-pending",
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 3, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_10_MINUTES_MS, runAtBoot: true },
  handler: reapPendingClips,
})

defineJobKind({
  kind: "upload.reap-tickets",
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 3, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_10_MINUTES_MS, runAtBoot: true },
  handler: reapExpiredUploadTickets,
})

defineJobKind({
  kind: "auth.sweep-challenges",
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 3, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_5_MINUTES_MS, runAtBoot: true },
  handler: sweepExpiredChallenges,
})

defineJobKind({
  kind: "clip.reconcile",
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 70,
  retry: { maxAttempts: 3, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_10_MINUTES_MS, runAtBoot: true },
  handler: reconcileClipEncodeJobs,
})

defineJobKind({
  kind: "jobs.prune",
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 3, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_DAY_MS, runAtBoot: true },
  handler: pruneJobs,
})

async function reapPendingClips(): Promise<void> {
  const stale = await db
    .select({ id: clip.id, authorId: clip.author_id })
    .from(clip)
    .where(
      and(
        eq(clip.status, "pending"),
        lt(
          clip.created_at,
          sql`now() - ${configStore.get("limits").uploadTtlSec} * interval '1 second'`,
        ),
      ),
    )

  for (const row of stale) {
    await cleanupTickets(
      { type: "clip", id: row.id },
      `stale clip ${row.id} upload`,
    )
    await db.delete(clip).where(eq(clip.id, row.id))
    publishClipRemove(row.authorId, row.id)
  }
}

async function reapExpiredUploadTickets(): Promise<void> {
  const expiredTickets = await db
    .select({
      id: uploadTicket.id,
      storageKey: uploadTicket.storage_key,
    })
    .from(uploadTicket)
    .where(
      and(
        isNull(uploadTicket.used_at),
        lt(uploadTicket.expires_at, sql`now()`),
      ),
    )

  for (const ticket of expiredTickets) {
    try {
      await deleteStagedUpload(ticket.storageKey)
    } catch (err) {
      logger.warn(
        `could not delete expired staged object ${ticket.storageKey}:`,
        err,
      )
      continue
    }
    await db.delete(uploadTicket).where(eq(uploadTicket.id, ticket.id))
  }
}

async function sweepExpiredChallenges(): Promise<void> {
  await db.delete(authChallenge).where(lt(authChallenge.expires_at, sql`now()`))
}

async function reconcileClipEncodeJobs(): Promise<void> {
  const rows = await db
    .select({ id: clip.id })
    .from(clip)
    .where(
      and(
        or(
          eq(clip.status, "processing"),
          and(
            eq(clip.status, "ready"),
            lt(clip.encode_progress, 100),
            isNull(clip.failure_reason),
          ),
        ),
        sql`not exists (
          select 1
          from ${job}
          where ${job.kind} = 'clip.encode'
            and ${job.dedup_key} = ${clip.id}::text
            and ${job.status} in ('pending', 'running')
        )`,
      ),
    )

  for (const row of rows) {
    await enqueueClipEncode(row.id, { trigger: "reconcile", priority: 70 })
  }
}

async function pruneJobs(): Promise<void> {
  const cutoffs = await client.query<{
    completedBefore: Date
    failedBefore: Date
  }>(
    "select now() - interval '7 days' as \"completedBefore\", now() - interval '90 days' as \"failedBefore\"",
  )
  const row = cutoffs.rows[0]
  if (!row) return
  await prune(row.completedBefore, row.failedBefore)
}
