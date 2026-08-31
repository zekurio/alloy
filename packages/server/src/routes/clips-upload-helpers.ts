import { user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { selectSourceStorageUsedBytes } from "@alloy/server/storage/quota"
import { deleteUploadTicketsWithStorageIntents } from "@alloy/server/uploads/tickets"
import { and, eq, inArray, sql } from "drizzle-orm"

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

export async function resolveMentionUsernames(
  usernames: ReadonlyArray<string>,
  actorId: string,
): Promise<string[]> {
  const deduped = [
    ...new Set(usernames.map((username) => username.toLowerCase())),
  ]
  if (deduped.length === 0) return []
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(inArray(sql`lower(${user.username})`, deduped))
  return rows.flatMap((row) => (row.id === actorId ? [] : [row.id]))
}

export async function markUploadFailed(
  authorId: string,
  clipId: string,
  reason: string,
): Promise<void> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(clip)
      .set({
        status: "failed",
        upload_cleanup_at: null,
        encode_request_id: null,
        encode_request_force: false,
        encode_requested_at: null,
        encode_run_after: null,
        encode_priority: 90,
        encode_claimed_request_id: null,
        encode_run_id: null,
        encode_locked_at: null,
        encode_attempt: 0,
        encode_stage: null,
        encode_tier: null,
        encode_tier_index: null,
        encode_tier_count: null,
        encode_progress: 0,
        encode_failed_fingerprint: null,
        encode_failed_generation: null,
        failure_reason: reason.slice(0, 500),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(clip.id, clipId),
          inArray(clip.status, ["pending", "processing"]),
        ),
      )
      .returning({ id: clip.id })
    if (!row) return { updated: false, queued: 0 }
    const queued = await deleteUploadTicketsWithStorageIntents(
      { type: "clip", id: clipId },
      `clip upload failed: ${reason}`,
      tx,
    )
    return { updated: true, queued }
  })
  if (result.queued > 0) wakeStorageDeletionWorker()
  if (result.updated) void publishClipUpsert(authorId, clipId)
}
