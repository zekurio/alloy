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

export interface RecoverableUploadTicket {
  id: string
  storageKey: string
  contentType: string
  expectedBytes: number
}

export interface PendingUploadCleanupOperations {
  recheck(): Promise<boolean>
  selectUnusedTickets(): Promise<readonly RecoverableUploadTicket[]>
  resolve(
    ticket: RecoverableUploadTicket,
  ): Promise<{ size: number; contentType: string } | null>
  adopt(ticket: RecoverableUploadTicket): Promise<boolean>
  remove(): Promise<boolean>
}

export type PendingUploadCleanupResult = "adopted" | "changed" | "deleted"

/**
 * Recover a final object whose storage commit outran DB adoption. Storage IO
 * deliberately happens outside a DB transaction; both ownership gates remain
 * held, and the adoption transaction repeats the exact deadline predicate.
 */
export async function runPendingUploadCleanup(
  operations: PendingUploadCleanupOperations,
): Promise<PendingUploadCleanupResult> {
  if (!(await operations.recheck())) return "changed"

  const tickets = await operations.selectUnusedTickets()
  for (const ticket of tickets) {
    const object = await operations.resolve(ticket)
    if (
      !object ||
      !completedUploadMatches(object, {
        bytes: ticket.expectedBytes,
        contentType: ticket.contentType,
      })
    ) {
      continue
    }

    return (await operations.adopt(ticket)) ? "adopted" : "changed"
  }

  return (await operations.remove()) ? "deleted" : "changed"
}

interface PendingUploadCleanupGates {
  withMediaStopped<T>(id: string, operation: () => Promise<T>): Promise<T>
  withUploadStopped<T>(id: string, operation: () => Promise<T>): Promise<T>
}

const defaultGates: PendingUploadCleanupGates = {
  withMediaStopped: withClipMediaStopped,
  withUploadStopped: withUploadActivityStopped,
}

export function withPendingUploadCleanupStopped<T>(
  clipId: string,
  operation: () => Promise<T>,
  gates: PendingUploadCleanupGates = defaultGates,
): Promise<T> {
  return gates.withMediaStopped(clipId, () =>
    gates.withUploadStopped(clipId, operation),
  )
}

export async function cleanupPendingUploadCandidate(
  row: typeof clip.$inferSelect,
  uploadTtlSec: number,
): Promise<PendingUploadCleanupResult> {
  const deadline = row.upload_cleanup_at
  if (!deadline) return "changed"

  return withPendingUploadCleanupStopped(row.id, () =>
    runPendingUploadCleanup({
      async recheck() {
        const [fresh] = await db
          .select({
            status: clip.status,
            deadline: clip.upload_cleanup_at,
            due: sql<boolean | null>`${clip.upload_cleanup_at} <= now()`,
          })
          .from(clip)
          .where(eq(clip.id, row.id))
          .limit(1)
        return (
          fresh?.status === "pending" &&
          pendingUploadCleanupStillDue({
            selectedDeadline: deadline,
            currentDeadline: fresh.deadline,
            dueAtLock: fresh.due ?? false,
          })
        )
      },
      selectUnusedTickets() {
        return db
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
      },
      resolve(ticket) {
        return resolveStagedUpload(ticket.storageKey)
      },
      adopt(ticket) {
        return markUploadTicketUsedAndExtendDeadline(ticket.id, uploadTtlSec, {
          expectedCleanupAt: deadline,
        })
      },
      remove() {
        return deleteClipRowAndAssets(row, {
          expectedStatus: "pending",
          expectedUploadCleanupAt: deadline,
          ownershipStopped: true,
        })
      },
    }),
  )
}
