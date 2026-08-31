import type { UploadTicketRole } from "@alloy/contracts"
import { clip, uploadTicket, type UploadTicketTarget } from "@alloy/db/schema"
import { configStore } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { stagedUploadDeletionIntent } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { and, eq, isNull, lte, sql } from "drizzle-orm"

import { completedUploadDeadline, uploadTicketCanFinalize } from "./deadline"

/** Identifies the clip an upload ticket belongs to. */
export interface UploadTarget {
  type: UploadTicketTarget
  id: string
}

function targetMatch(target: UploadTarget) {
  return and(
    eq(uploadTicket.target_type, target.type),
    eq(uploadTicket.target_id, target.id),
  )
}

export async function createUploadTickets(
  input: {
    target: UploadTarget
    ownerId: string
    videoKey: string
    videoContentType: string
    videoBytes: number
    expiresAt: Date
  },
  options: { tx?: DbTransaction } = {},
): Promise<void> {
  const executor = options.tx ?? db
  await executor.insert(uploadTicket).values({
    owner_id: input.ownerId,
    target_type: input.target.type,
    target_id: input.target.id,
    role: "video",
    storage_key: input.videoKey,
    content_type: input.videoContentType,
    expected_bytes: input.videoBytes,
    expires_at: input.expiresAt,
  })
}

export async function assertUsableVideoTicket(input: {
  target: UploadTarget
  storageKey: string
  contentType: string
  expectedBytes: number
  uploadCleanupAt: Date | null
}): Promise<boolean> {
  const now = new Date()
  const [ticket] = await db
    .select({
      expiresAt: sql<Date>`${uploadTicket.expires_at} at time zone 'UTC'`,
      usedAt: sql<Date | null>`${uploadTicket.used_at} at time zone 'UTC'`,
    })
    .from(uploadTicket)
    .where(
      and(
        targetMatch(input.target),
        eq(uploadTicket.storage_key, input.storageKey),
        eq(uploadTicket.content_type, input.contentType),
        eq(uploadTicket.expected_bytes, input.expectedBytes),
        eq(uploadTicket.role, "video"),
      ),
    )
    .limit(1)
  return ticket
    ? uploadTicketCanFinalize(ticket, input.uploadCleanupAt, now)
    : false
}

export interface SelectedUploadTicket {
  id: string
  storageKey: string
  contentType: string
  expectedBytes: number
  expiresAt: Date
  usedAt: Date | null
  createdAt: Date
}

export function effectiveUploadTicketDeadline(
  ticket: Pick<SelectedUploadTicket, "expiresAt" | "usedAt">,
  uploadTtlSec: number,
): number {
  return ticket.usedAt === null
    ? ticket.expiresAt.getTime()
    : Math.max(
        ticket.expiresAt.getTime(),
        completedUploadDeadline(ticket.usedAt, uploadTtlSec).getTime(),
      )
}

/** Match the max-deadline rule used by legacy repair with stable tie breaks. */
export function selectPreferredUploadTicket<T extends SelectedUploadTicket>(
  tickets: readonly T[],
  uploadTtlSec: number,
): T | null {
  let preferred: T | null = null
  for (const ticket of tickets) {
    if (
      !preferred ||
      uploadTicketIsPreferred(ticket, preferred, uploadTtlSec)
    ) {
      preferred = ticket
    }
  }
  return preferred
}

function uploadTicketIsPreferred(
  candidate: SelectedUploadTicket,
  current: SelectedUploadTicket,
  uploadTtlSec: number,
): boolean {
  const deadlineDifference =
    effectiveUploadTicketDeadline(candidate, uploadTtlSec) -
    effectiveUploadTicketDeadline(current, uploadTtlSec)
  if (deadlineDifference !== 0) return deadlineDifference > 0
  if ((candidate.usedAt !== null) !== (current.usedAt !== null)) {
    return candidate.usedAt !== null
  }
  const creationDifference =
    candidate.createdAt.getTime() - current.createdAt.getTime()
  if (creationDifference !== 0) return creationDifference > 0
  return candidate.id.localeCompare(current.id) > 0
}

async function selectTicket(
  target: UploadTarget,
  role: UploadTicketRole,
): Promise<SelectedUploadTicket | null> {
  const tickets = await db
    .select({
      id: uploadTicket.id,
      storageKey: uploadTicket.storage_key,
      contentType: uploadTicket.content_type,
      expectedBytes: uploadTicket.expected_bytes,
      expiresAt: sql<Date>`${uploadTicket.expires_at} at time zone 'UTC'`,
      usedAt: sql<Date | null>`${uploadTicket.used_at} at time zone 'UTC'`,
      createdAt: sql<Date>`${uploadTicket.created_at} at time zone 'UTC'`,
    })
    .from(uploadTicket)
    .where(and(targetMatch(target), eq(uploadTicket.role, role)))
  return selectPreferredUploadTicket(
    tickets,
    configStore.get("limits").uploadTtlSec,
  )
}

export function selectVideoTicketKey(
  target: UploadTarget,
): Promise<string | null> {
  return selectTicket(target, "video").then(
    (ticket) => ticket?.storageKey ?? null,
  )
}

export function selectVideoTicket(target: UploadTarget) {
  return selectTicket(target, "video")
}

/** Mark one accepted legacy ticket used inside its caller's transaction. */
export async function markUploadTicketUsed(
  ticketId: string,
  usedAt: Date,
  tx: DbTransaction,
): Promise<string | null> {
  const [row] = await tx
    .update(uploadTicket)
    .set({ used_at: usedAt })
    .where(and(eq(uploadTicket.id, ticketId), isNull(uploadTicket.used_at)))
    .returning({ targetId: uploadTicket.target_id })
  return row?.targetId ?? null
}

/**
 * Persist byte completion and the pending clip's grace deadline atomically.
 * The upload activity gate around the caller keeps cleanup/finalize outside
 * this transaction until both ownership changes are committed.
 */
export async function markUploadTicketUsedAndExtendDeadline(
  ticketId: string,
  uploadTtlSec: number,
  options: { expectedCleanupAt?: Date | null } = {},
): Promise<boolean> {
  const usedAt = new Date()
  const cleanupAt = completedUploadDeadline(usedAt, uploadTtlSec)
  try {
    return await db.transaction(async (tx) => {
      const targetId = await markUploadTicketUsed(ticketId, usedAt, tx)
      if (!targetId) return false
      const conditions = [eq(clip.id, targetId), eq(clip.status, "pending")]
      const expectedCleanupAt = options.expectedCleanupAt
      if (expectedCleanupAt !== undefined) {
        conditions.push(
          expectedCleanupAt === null
            ? isNull(clip.upload_cleanup_at)
            : eq(clip.upload_cleanup_at, expectedCleanupAt),
        )
      }
      const [updated] = await tx
        .update(clip)
        .set({
          upload_cleanup_at: sql<Date>`greatest(
            coalesce(${clip.upload_cleanup_at}, ${cleanupAt}),
            ${cleanupAt}
          )`,
        })
        .where(and(...conditions))
        .returning({ id: clip.id })
      if (!updated) throw new UploadCompletionOwnershipChangedError()
      return true
    })
  } catch (err) {
    if (err instanceof UploadCompletionOwnershipChangedError) return false
    throw err
  }
}

class UploadCompletionOwnershipChangedError extends Error {}

type DeletedUploadTicket = {
  id: string
  storageKey: string
}

/**
 * Atomically detach every staged object owned by a target. The physical worker
 * is woken by the caller only after this transaction commits.
 */
export async function deleteUploadTicketsWithStorageIntents(
  target: UploadTarget,
  reason: string,
  tx: DbTransaction,
): Promise<number> {
  const rows = await tx
    .delete(uploadTicket)
    .where(targetMatch(target))
    .returning({
      id: uploadTicket.id,
      storageKey: uploadTicket.storage_key,
    })
  return enqueueDeletedUploadTickets(rows, reason, tx)
}

/** Atomically detach every residual staged object owned by one account. */
export async function deleteOwnedUploadTicketsWithStorageIntents(
  ownerId: string,
  reason: string,
  tx: DbTransaction,
): Promise<number> {
  const rows = await tx
    .delete(uploadTicket)
    .where(eq(uploadTicket.owner_id, ownerId))
    .returning({
      id: uploadTicket.id,
      storageKey: uploadTicket.storage_key,
    })
  return enqueueDeletedUploadTickets(rows, reason, tx)
}

/** Atomically cancel one still-owned upload ticket by its durable identity. */
export async function deleteUploadTicketWithStorageIntent(
  ticketId: string,
  reason: string,
  tx: DbTransaction,
): Promise<number> {
  const rows = await tx
    .delete(uploadTicket)
    .where(eq(uploadTicket.id, ticketId))
    .returning({
      id: uploadTicket.id,
      storageKey: uploadTicket.storage_key,
    })
  return enqueueDeletedUploadTickets(rows, reason, tx)
}

/** Claim every expired, unused ticket without racing a late successful use. */
export async function deleteExpiredUploadTicketWithStorageIntent(
  ticketId: string,
  expiresBefore: Date,
  reason: string,
  tx: DbTransaction,
): Promise<number> {
  const rows = await tx
    .delete(uploadTicket)
    .where(
      and(
        eq(uploadTicket.id, ticketId),
        isNull(uploadTicket.used_at),
        lte(uploadTicket.expires_at, expiresBefore),
      ),
    )
    .returning({
      id: uploadTicket.id,
      storageKey: uploadTicket.storage_key,
    })
  return enqueueDeletedUploadTickets(rows, reason, tx)
}

async function enqueueDeletedUploadTickets(
  rows: readonly DeletedUploadTicket[],
  reason: string,
  tx: DbTransaction,
): Promise<number> {
  await enqueueStorageDeletions(
    rows.map((row) =>
      stagedUploadDeletionIntent({
        key: row.storageKey,
        reason,
        source: { type: "upload-ticket", id: row.id },
      }),
    ),
    { tx },
  )
  return rows.length
}
