import type { UploadTicketRole } from "@alloy/contracts"
import { clip, uploadTicket, type UploadTicketTarget } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { stagedUploadDeletionIntent } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { and, desc, eq, isNull, sql } from "drizzle-orm"

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
      expiresAt: uploadTicket.expires_at,
      usedAt: uploadTicket.used_at,
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

async function selectTicket(
  target: UploadTarget,
  role: UploadTicketRole,
): Promise<SelectedUploadTicket | null> {
  const [ticket] = await db
    .select({
      id: uploadTicket.id,
      storageKey: uploadTicket.storage_key,
      contentType: uploadTicket.content_type,
      expectedBytes: uploadTicket.expected_bytes,
      expiresAt: uploadTicket.expires_at,
      usedAt: uploadTicket.used_at,
      createdAt: uploadTicket.created_at,
    })
    .from(uploadTicket)
    .where(and(targetMatch(target), eq(uploadTicket.role, role)))
    .orderBy(desc(uploadTicket.created_at), desc(uploadTicket.id))
    .limit(1)
  return ticket ?? null
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

/** Mark one accepted ticket used inside its caller's transaction. */
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
  targetId: string,
  expiresBefore: Date,
  reason: string,
  tx: DbTransaction,
): Promise<number> {
  const rows = await tx
    .delete(uploadTicket)
    .where(
      expiredOrphanUploadTicketPredicate(ticketId, targetId, expiresBefore),
    )
    .returning({
      id: uploadTicket.id,
      storageKey: uploadTicket.storage_key,
    })
  return enqueueDeletedUploadTickets(rows, reason, tx)
}

/** Exact destructive CAS repeated after acquiring the target upload-stop gate. */
function expiredOrphanUploadTicketPredicate(
  ticketId: string,
  targetId: string,
  expiresBefore: Date,
) {
  return and(
    eq(uploadTicket.id, ticketId),
    eq(uploadTicket.target_type, "clip"),
    eq(uploadTicket.target_id, targetId),
    isNull(uploadTicket.used_at),
    // upload_ticket predates timestamptz. Compare the DB scan's captured
    // instant against its timestamp-without-time-zone value as UTC.
    sql`${uploadTicket.expires_at} <= (cast(${expiresBefore} as timestamptz) at time zone 'UTC')`,
    // Pending cleanup owns crash recovery, while processing may still read a
    // ticket's object. Terminal and missing owners are safe to retire.
    sql`not exists (
      select 1
      from ${clip} owner
      where owner.id = ${targetId}
        and owner.status in ('pending', 'processing')
    )`,
  )!
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
