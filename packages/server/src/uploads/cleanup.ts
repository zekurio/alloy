import { clip, uploadTicket } from "@alloy/db/schema"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { db } from "@alloy/server/db/index"
import { withClipMediaStopped } from "@alloy/server/queue/clip-media-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { resolveStagedUpload } from "@alloy/server/uploads/staged"
import { and, eq, isNull, sql } from "drizzle-orm"

import {
  completedUploadMatches,
  pendingUploadCleanupStillDue,
} from "./deadline"
import { markUploadTicketUsedAndExtendDeadline } from "./tickets"

type PendingUploadCleanupResult = "adopted" | "changed" | "deleted"

/**
 * Clean up a pending upload whose deadline passed, first recovering a final
 * object whose storage commit outran DB adoption. Storage IO deliberately
 * happens outside a DB transaction; both ownership gates remain held, and the
 * adoption transaction repeats the exact deadline predicate.
 */
export async function cleanupPendingUploadCandidate(
  row: typeof clip.$inferSelect,
  uploadTtlSec: number,
): Promise<PendingUploadCleanupResult> {
  const deadline = row.upload_cleanup_at
  if (!deadline) return "changed"

  return withClipMediaStopped(row.id, () =>
    withUploadActivityStopped(row.id, async () => {
      if (!(await pendingUploadStillDue(row.id, deadline))) return "changed"

      const tickets = await db
        .select({
          id: uploadTicket.id,
          storageKey: uploadTicket.storage_key,
          contentType: uploadTicket.content_type,
          expectedBytes: uploadTicket.expected_bytes,
        })
        .from(uploadTicket)
        .where(
          and(
            eq(uploadTicket.target_type, "clip"),
            eq(uploadTicket.target_id, row.id),
            eq(uploadTicket.role, "video"),
            isNull(uploadTicket.used_at),
          ),
        )
      for (const ticket of tickets) {
        const object = await resolveStagedUpload(ticket.storageKey)
        if (
          !object ||
          !completedUploadMatches(object, {
            bytes: ticket.expectedBytes,
            contentType: ticket.contentType,
          })
        ) {
          continue
        }

        const adopted = await markUploadTicketUsedAndExtendDeadline(
          ticket.id,
          uploadTtlSec,
          { expectedCleanupAt: deadline },
        )
        return adopted ? "adopted" : "changed"
      }

      const deleted = await deleteClipRowAndAssets(row, {
        expectedStatus: "pending",
        expectedUploadCleanupAt: deadline,
        ownershipStopped: true,
      })
      return deleted ? "deleted" : "changed"
    }),
  )
}

async function pendingUploadStillDue(
  clipId: string,
  selectedDeadline: Date,
): Promise<boolean> {
  const [fresh] = await db
    .select({
      status: clip.status,
      deadline: clip.upload_cleanup_at,
      due: sql<boolean | null>`${clip.upload_cleanup_at} <= now()`,
    })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  return (
    fresh?.status === "pending" &&
    pendingUploadCleanupStillDue({
      selectedDeadline,
      currentDeadline: fresh.deadline,
      dueAtLock: fresh.due ?? false,
    })
  )
}
