import { user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { selectSourceStorageUsedBytes } from "@alloy/server/storage/quota"
import { eq, inArray, sql } from "drizzle-orm"

export type UploadQuotaResult =
  | { ok: true }
  | { ok: false; usedBytes: number; quotaBytes: number }

export function uploadWouldExceedQuota({
  quotaBytes,
  usedBytes,
  incomingBytes,
  reservedBytes = 0,
}: {
  quotaBytes: number
  usedBytes: number
  incomingBytes: number
  reservedBytes?: number
}): boolean {
  return usedBytes - reservedBytes + incomingBytes > quotaBytes
}

type QuotaDb = Pick<typeof db, "execute" | "select">

export async function selectLockedQuotaState(
  database: QuotaDb,
  viewerId: string,
) {
  await database.execute(
    sql`select "id" from "user" where "id" = ${viewerId} for update`,
  )
  const [quotaRow] = await database
    .select({ storageQuotaBytes: user.storage_quota_bytes })
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
      failure_reason: reason.slice(0, 500),
      updated_at: new Date(),
    })
    .where(eq(clip.id, clipId))
  void publishClipUpsert(authorId, clipId)
}
