import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"
import { clip, clipUploadTicket } from "@workspace/db/schema"

import { db } from "../db"
import { publishClipUpsert } from "../clips/events"
import { createNotification } from "../notifications"
import { selectSourceStorageUsedBytes } from "../storage/quota"

export type InitiateQuotaResult =
  | { ok: true }
  | { ok: false; usedBytes: number; quotaBytes: number }

type QuotaDb = Pick<typeof db, "execute" | "select">

export async function selectLockedQuotaState(
  database: QuotaDb,
  viewerId: string
) {
  await database.execute(
    sql`select "id" from "user" where "id" = ${viewerId} for update`
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
  authorId: string
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
  reason: string
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

export async function createUploadTickets(input: {
  clipId: string
  videoKey: string
  videoContentType: string
  videoBytes: number
  thumbKey: string
  thumbBytes: number
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
      role: "thumbnail",
      storageKey: input.thumbKey,
      contentType: "image/jpeg",
      expectedBytes: input.thumbBytes,
      expiresAt: input.expiresAt,
    },
  ])
}

export async function markUploadTicketUsed(storageKey: string): Promise<void> {
  await db
    .update(clipUploadTicket)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(clipUploadTicket.storageKey, storageKey),
        isNull(clipUploadTicket.usedAt)
      )
    )
}

export type UploadTicketCheckResult =
  | { status: "usable" }
  | { status: "missing" }
  | { status: "invalid"; reason: "expired" | "mismatch" }

export async function checkUploadTicket(input: {
  clipId: string
  storageKey: string
  contentType: string
  expectedBytes: number
  role: "video" | "thumbnail"
}): Promise<UploadTicketCheckResult> {
  const [ticket] = await db
    .select({
      contentType: clipUploadTicket.contentType,
      expectedBytes: clipUploadTicket.expectedBytes,
      expiresAt: clipUploadTicket.expiresAt,
    })
    .from(clipUploadTicket)
    .where(
      and(
        eq(clipUploadTicket.clipId, input.clipId),
        eq(clipUploadTicket.storageKey, input.storageKey),
        eq(clipUploadTicket.role, input.role)
      )
    )
    .limit(1)
  if (!ticket) return { status: "missing" }
  if (
    ticket.contentType !== input.contentType ||
    ticket.expectedBytes !== input.expectedBytes
  ) {
    return { status: "invalid", reason: "mismatch" }
  }
  if (ticket.expiresAt <= new Date()) {
    return { status: "invalid", reason: "expired" }
  }
  return { status: "usable" }
}
