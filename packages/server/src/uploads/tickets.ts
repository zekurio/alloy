import type { UploadTicketRole } from "@alloy/contracts"
import { uploadTicket, type UploadTicketTarget } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { stagedUploadDeletionIntent } from "@alloy/server/storage/deletion-producers"
import { enqueueStorageDeletion } from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { and, eq, gt, isNull, lt } from "drizzle-orm"

import { withUploadActivityStopped } from "./activity"

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

export async function createUploadTickets(input: {
  target: UploadTarget
  ownerId: string
  videoKey: string
  videoContentType: string
  videoBytes: number
  expiresAt: Date
}): Promise<void> {
  await db.insert(uploadTicket).values({
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
}): Promise<boolean> {
  const [ticket] = await db
    .select({ id: uploadTicket.id })
    .from(uploadTicket)
    .where(
      and(
        targetMatch(input.target),
        eq(uploadTicket.storage_key, input.storageKey),
        eq(uploadTicket.content_type, input.contentType),
        eq(uploadTicket.expected_bytes, input.expectedBytes),
        eq(uploadTicket.role, "video"),
        gt(uploadTicket.expires_at, new Date()),
      ),
    )
    .limit(1)
  return Boolean(ticket)
}

async function selectTicketKey(
  target: UploadTarget,
  role: UploadTicketRole,
): Promise<string | null> {
  const [ticket] = await db
    .select({ storageKey: uploadTicket.storage_key })
    .from(uploadTicket)
    .where(and(targetMatch(target), eq(uploadTicket.role, role)))
    .limit(1)
  return ticket?.storageKey ?? null
}

async function selectTicket(
  target: UploadTarget,
  role: UploadTicketRole,
): Promise<{
  storageKey: string
  contentType: string
  expectedBytes: number
  expiresAt: Date
} | null> {
  const [ticket] = await db
    .select({
      storageKey: uploadTicket.storage_key,
      contentType: uploadTicket.content_type,
      expectedBytes: uploadTicket.expected_bytes,
      expiresAt: uploadTicket.expires_at,
    })
    .from(uploadTicket)
    .where(and(targetMatch(target), eq(uploadTicket.role, role)))
    .limit(1)
  return ticket ?? null
}

export function selectVideoTicketKey(
  target: UploadTarget,
): Promise<string | null> {
  return selectTicketKey(target, "video")
}

export function selectVideoTicket(target: UploadTarget) {
  return selectTicket(target, "video")
}

export async function selectTicketKeys(
  target: UploadTarget,
): Promise<Array<{ key: string }>> {
  const tickets = await db
    .select({
      storageKey: uploadTicket.storage_key,
    })
    .from(uploadTicket)
    .where(targetMatch(target))
  return tickets.map((ticket) => ({
    key: ticket.storageKey,
  }))
}

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
        lt(uploadTicket.expires_at, expiresBefore),
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
  for (const row of rows) {
    await enqueueStorageDeletion(
      stagedUploadDeletionIntent({
        key: row.storageKey,
        reason,
        source: { type: "upload-ticket", id: row.id },
      }),
      { tx },
    )
  }
  return rows.length
}

/**
 * Standalone compatibility wrapper for media paths not yet adopted into their
 * owning transaction. It is durable, but a crash before this function is
 * called remains the generated-media layer's responsibility.
 */
export async function cleanupTickets(
  target: UploadTarget,
  reason: string,
): Promise<void> {
  const queued = await withUploadActivityStopped(target.id, () =>
    db.transaction((tx) =>
      deleteUploadTicketsWithStorageIntents(target, reason, tx),
    ),
  )
  if (queued > 0) wakeStorageDeletionWorker()
}
