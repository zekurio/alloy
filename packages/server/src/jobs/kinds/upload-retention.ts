import { clip, uploadTicket } from "@alloy/db/schema"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { cleanupPendingUploadCandidate } from "@alloy/server/uploads/cleanup"
import { deleteExpiredUploadTicketWithStorageIntent } from "@alloy/server/uploads/tickets"
import { and, asc, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm"

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
        isNotNull(clip.upload_cleanup_at),
        lte(clip.upload_cleanup_at, sql`now()`),
      ),
    )
    .orderBy(asc(clip.upload_cleanup_at), asc(clip.id))

  for (const row of stale) {
    if (!row.upload_cleanup_at) continue
    await cleanupPendingUploadCandidate(
      row,
      configStore.get("limits").uploadTtlSec,
    )
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
    .leftJoin(
      clip,
      and(
        eq(uploadTicket.target_type, "clip"),
        eq(uploadTicket.target_id, clip.id),
      ),
    )
    .where(
      and(
        isNull(uploadTicket.used_at),
        lte(uploadTicket.expires_at, expiresBefore),
        // Pending clips own both their ticket and crash-window recovery. Do
        // not detach a ticket merely because its deadline crossed after the
        // clip phase took its snapshot; the next clip pass will adopt exact
        // committed bytes or delete both owners under the shared gates.
        or(isNull(clip.id), ne(clip.status, "pending")),
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
