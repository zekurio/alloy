import { clip, uploadTicket } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { stagedUploadDeletionIntent } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletions } from "@alloy/server/storage/deletion-store"
import { and, desc, eq, isNull, sql } from "drizzle-orm"

import { completedUploadDeadline, uploadTicketCanFinalize } from "./deadline"

export async function createUploadTickets(
  input: {
    clipId: string
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
    target_id: input.clipId,
    storage_key: input.videoKey,
    content_type: input.videoContentType,
    expected_bytes: input.videoBytes,
    expires_at: input.expiresAt,
  })
}

export async function assertUsableVideoTicket(input: {
  clipId: string
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
        eq(uploadTicket.target_id, input.clipId),
        eq(uploadTicket.storage_key, input.storageKey),
        eq(uploadTicket.content_type, input.contentType),
        eq(uploadTicket.expected_bytes, input.expectedBytes),
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

/**
 * The clip's upload ticket, limited to `ownerId`'s when given. Initiate
 * inserts the only one, in the transaction that creates the clip row, so the
 * ordering just keeps the pick deterministic.
 */
export async function selectVideoTicket(
  clipId: string,
  options: { ownerId?: string } = {},
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
    .where(
      and(
        eq(uploadTicket.target_id, clipId),
        options.ownerId === undefined
          ? undefined
          : eq(uploadTicket.owner_id, options.ownerId),
      ),
    )
    .orderBy(desc(uploadTicket.created_at), desc(uploadTicket.id))
    .limit(1)
  return ticket ?? null
}

/** SQL condition: the clip row in scope still owns a staged upload. */
export function clipOwnsUpload() {
  return sql`exists (select 1 from ${uploadTicket} where ${uploadTicket.target_id} = ${clip.id})`
}

export async function selectVideoTicketKey(
  clipId: string,
): Promise<string | null> {
  return (await selectVideoTicket(clipId))?.storageKey ?? null
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
          upload_cleanup_at: sql<Date>`greatest(${clip.upload_cleanup_at}, ${cleanupAt})`,
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
 * Atomically detach every staged object owned by a clip. The physical worker
 * is woken by the caller only after this transaction commits.
 */
export async function deleteUploadTicketsWithStorageIntents(
  clipId: string,
  reason: string,
  tx: DbTransaction,
): Promise<number> {
  const rows = await tx
    .delete(uploadTicket)
    .where(eq(uploadTicket.target_id, clipId))
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
