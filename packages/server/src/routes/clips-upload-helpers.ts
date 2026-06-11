import { user } from "@alloy/db/auth-schema"
import { clip, clipUploadTicket } from "@alloy/db/schema"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { createNotification } from "@alloy/server/notifications/index"
import { selectSourceStorageUsedBytes } from "@alloy/server/storage/quota"
import { and, eq, gt, inArray, sql } from "drizzle-orm"

export type InitiateQuotaResult =
  | { ok: true }
  | { ok: false; usedBytes: number; quotaBytes: number }

type QuotaDb = Pick<typeof db, "execute" | "select">

export async function selectLockedQuotaState(
  database: QuotaDb,
  viewerId: string,
) {
  await database.execute(
    sql`select "id" from "user" where "id" = ${viewerId} for update`,
  )
  const [quotaRow] = await database
    .select({ storageQuotaBytes: user.storageQuotaBytes })
    .from(user)
    .where(eq(user.id, viewerId))
    .limit(1)
  const quotaBytes = quotaRow?.storageQuotaBytes ?? null
  const usedBytes = await selectSourceStorageUsedBytes(database, viewerId)
  return { quotaBytes, usedBytes }
}

export async function resolveMentionIds(
  rawIds: ReadonlyArray<string>,
  authorId: string,
): Promise<string[]> {
  const deduped = [...new Set(rawIds)].filter((id) => id !== authorId)
  if (deduped.length === 0) return []
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.id, deduped))
  return rows.map((row) => row.id)
}

export async function markUploadFailed(
  authorId: string,
  clipId: string,
  reason: string,
): Promise<void> {
  await db
    .update(clip)
    .set({
      status: "failed",
      failureReason: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(clip.id, clipId))
  void publishClipUpsert(authorId, clipId)
  void createNotification({
    recipientId: authorId,
    type: "clip_upload_failed",
    clipId,
  })
}

/** Poster image content type the client renders and uploads. */
export const THUMB_UPLOAD_CONTENT_TYPE = "image/webp"

/**
 * Hard cap for the uploaded poster image. The client renders a small webp
 * (<2 MB); this leaves headroom while keeping the scratch upload bounded.
 */
export const THUMB_UPLOAD_MAX_BYTES = 4 * 1024 * 1024

export async function createUploadTickets(input: {
  clipId: string
  videoKey: string
  videoContentType: string
  videoBytes: number
  thumbKey: string
  expiresAt: Date
}): Promise<void> {
  await db.insert(clipUploadTicket).values([
    {
      clipId: input.clipId,
      role: "video",
      storageKey: input.videoKey,
      contentType: input.videoContentType,
      expectedBytes: input.videoBytes,
      expiresAt: input.expiresAt,
    },
    {
      clipId: input.clipId,
      role: "thumb",
      storageKey: input.thumbKey,
      contentType: THUMB_UPLOAD_CONTENT_TYPE,
      expectedBytes: THUMB_UPLOAD_MAX_BYTES,
      expiresAt: input.expiresAt,
    },
  ])
}

export async function assertUsableUploadTicket(input: {
  clipId: string
  storageKey: string
  contentType: string
  expectedBytes: number
  role: "video"
}): Promise<boolean> {
  const [ticket] = await db
    .select({ id: clipUploadTicket.id })
    .from(clipUploadTicket)
    .where(
      and(
        eq(clipUploadTicket.clipId, input.clipId),
        eq(clipUploadTicket.storageKey, input.storageKey),
        eq(clipUploadTicket.contentType, input.contentType),
        eq(clipUploadTicket.expectedBytes, input.expectedBytes),
        eq(clipUploadTicket.role, input.role),
        gt(clipUploadTicket.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return Boolean(ticket)
}
