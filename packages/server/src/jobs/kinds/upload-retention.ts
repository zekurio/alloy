import { clip, uploadTicket } from "@alloy/db/schema"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { deleteExpiredUploadTicketWithStorageIntent } from "@alloy/server/uploads/tickets"
import { and, eq, isNull, lt, sql } from "drizzle-orm"

import { EmptyPayloadSchema } from "../payloads"
import { defineJobKind } from "../registry"

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
    .select()
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
    await deleteClipRowAndAssets(row, { expectedStatus: "pending" })
  }
}

async function removeExpiredUploadTickets(): Promise<void> {
  const expiresBefore = new Date()
  const expiredTickets = await db
    .select({
      id: uploadTicket.id,
      targetId: uploadTicket.target_id,
    })
    .from(uploadTicket)
    .where(
      and(
        isNull(uploadTicket.used_at),
        lt(uploadTicket.expires_at, expiresBefore),
      ),
    )

  let queued = 0
  for (const ticket of expiredTickets) {
    queued += await withUploadActivityStopped(ticket.targetId, () =>
      db.transaction((tx) =>
        deleteExpiredUploadTicketWithStorageIntent(
          ticket.id,
          expiresBefore,
          "upload ticket expired",
          tx,
        ),
      ),
    )
  }
  if (queued > 0) wakeStorageDeletionWorker()
}
