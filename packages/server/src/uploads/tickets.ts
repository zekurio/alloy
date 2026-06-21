import { uploadTicket, type UploadTicketTarget } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { deleteStagedUploads } from "@alloy/server/uploads/staged"
import { and, eq, gt } from "drizzle-orm"

/** Identifies the clip an upload ticket belongs to. */
export interface UploadTarget {
  type: UploadTicketTarget
  id: string
}

/** Default poster image content type when the client doesn't pick one. */
export const THUMB_UPLOAD_CONTENT_TYPE = "image/jpeg"

/**
 * Hard cap for the uploaded poster image. The client renders a small JPEG
 * (<2 MB); this leaves headroom while keeping the staged upload bounded.
 */
export const THUMB_UPLOAD_MAX_BYTES = 4 * 1024 * 1024

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
  thumbKey: string
  thumbContentType?: string
  expiresAt: Date
}): Promise<void> {
  await db.insert(uploadTicket).values([
    {
      owner_id: input.ownerId,
      target_type: input.target.type,
      target_id: input.target.id,
      role: "video",
      storage_key: input.videoKey,
      content_type: input.videoContentType,
      expected_bytes: input.videoBytes,
      expires_at: input.expiresAt,
    },
    {
      owner_id: input.ownerId,
      target_type: input.target.type,
      target_id: input.target.id,
      role: "thumb",
      storage_key: input.thumbKey,
      content_type: input.thumbContentType ?? THUMB_UPLOAD_CONTENT_TYPE,
      expected_bytes: THUMB_UPLOAD_MAX_BYTES,
      expires_at: input.expiresAt,
    },
  ])
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
  role: "video" | "thumb",
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
  role: "video" | "thumb",
): Promise<{
  storageKey: string
} | null> {
  const [ticket] = await db
    .select({
      storageKey: uploadTicket.storage_key,
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

export function selectThumbTicket(target: UploadTarget) {
  return selectTicket(target, "thumb")
}

export function selectThumbTicketKey(
  target: UploadTarget,
): Promise<string | null> {
  return selectTicketKey(target, "thumb")
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

/** Drop the ticket rows for a recording (does not touch storage objects). */
export async function deleteTicketRows(target: UploadTarget): Promise<void> {
  await db.delete(uploadTicket).where(targetMatch(target))
}

/**
 * Delete a clip's staged upload objects AND their ticket rows. Used after a
 * successful publish/finalize and on terminal failure.
 */
export async function cleanupTickets(
  target: UploadTarget,
  label: string,
): Promise<void> {
  const keys = await selectTicketKeys(target)
  if (keys.length === 0) return
  await deleteStagedUploads(keys, label)
  await deleteTicketRows(target)
}
