import { uploadTicket, type UploadTicketTarget } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { deleteStagedUploads } from "@alloy/server/uploads/staged"
import { and, eq, gt } from "drizzle-orm"

/** Identifies the recording an upload ticket belongs to (clip or staging). */
export interface UploadTarget {
  type: UploadTicketTarget
  id: string
}

/** Default poster image content type when the client doesn't pick one. */
export const THUMB_UPLOAD_CONTENT_TYPE = "image/webp"

/**
 * Hard cap for the uploaded poster image. The client renders a small webp
 * (<2 MB); this leaves headroom while keeping the staged upload bounded.
 */
export const THUMB_UPLOAD_MAX_BYTES = 4 * 1024 * 1024

function targetMatch(target: UploadTarget) {
  return and(
    eq(uploadTicket.targetType, target.type),
    eq(uploadTicket.targetId, target.id),
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
      ownerId: input.ownerId,
      targetType: input.target.type,
      targetId: input.target.id,
      role: "video",
      storageKey: input.videoKey,
      contentType: input.videoContentType,
      expectedBytes: input.videoBytes,
      expiresAt: input.expiresAt,
    },
    {
      ownerId: input.ownerId,
      targetType: input.target.type,
      targetId: input.target.id,
      role: "thumb",
      storageKey: input.thumbKey,
      contentType: input.thumbContentType ?? THUMB_UPLOAD_CONTENT_TYPE,
      expectedBytes: THUMB_UPLOAD_MAX_BYTES,
      expiresAt: input.expiresAt,
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
        eq(uploadTicket.storageKey, input.storageKey),
        eq(uploadTicket.contentType, input.contentType),
        eq(uploadTicket.expectedBytes, input.expectedBytes),
        eq(uploadTicket.role, "video"),
        gt(uploadTicket.expiresAt, new Date()),
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
    .select({ storageKey: uploadTicket.storageKey })
    .from(uploadTicket)
    .where(and(targetMatch(target), eq(uploadTicket.role, role)))
    .limit(1)
  return ticket?.storageKey ?? null
}

export function selectVideoTicketKey(
  target: UploadTarget,
): Promise<string | null> {
  return selectTicketKey(target, "video")
}

export function selectThumbTicketKey(
  target: UploadTarget,
): Promise<string | null> {
  return selectTicketKey(target, "thumb")
}

export async function selectTicketKeys(
  target: UploadTarget,
): Promise<string[]> {
  const tickets = await db
    .select({ storageKey: uploadTicket.storageKey })
    .from(uploadTicket)
    .where(targetMatch(target))
  return tickets.map((ticket) => ticket.storageKey)
}

/** Drop the ticket rows for a recording (does not touch storage objects). */
export async function deleteTicketRows(target: UploadTarget): Promise<void> {
  await db.delete(uploadTicket).where(targetMatch(target))
}

/**
 * Delete a recording's staged upload objects AND their ticket rows. Used after
 * a successful publish/finalize and on terminal failure.
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
