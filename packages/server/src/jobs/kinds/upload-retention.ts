import { clip, uploadTicket } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { publishClipRemove } from "@alloy/server/clips/events"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { deleteStagedUpload } from "@alloy/server/uploads/staged"
import { cleanupTickets } from "@alloy/server/uploads/tickets"
import { and, eq, isNull, lt, sql } from "drizzle-orm"

import { EmptyPayloadSchema } from "../payloads"
import { defineJobKind } from "../registry"

const logger = createLogger("jobs")

const EVERY_10_MINUTES_MS = 10 * 60 * 1000

defineJobKind({
  kind: "upload.cleanup",
  queue: "maintenance",
  schema: EmptyPayloadSchema,
  defaultPriority: 50,
  retry: { maxAttempts: 3, backoffMs: 60_000 },
  schedule: { everyMs: EVERY_10_MINUTES_MS, runAtBoot: true },
  handler: cleanupUploads,
})

async function cleanupUploads(): Promise<void> {
  await removeAbandonedClipUploads()
  await removeExpiredUploadTickets()
}

async function removeAbandonedClipUploads(): Promise<void> {
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

async function removeExpiredUploadTickets(): Promise<void> {
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
