import { user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { publishClipUpsert } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import {
  selectLockedQuotaState,
  uploadWouldExceedQuota,
} from "@alloy/server/storage/quota"
import { deleteUploadTicketsWithStorageIntents } from "@alloy/server/uploads/tickets"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { Context } from "hono"

export type UploadQuotaResult =
  | { ok: true }
  | { ok: false; usedBytes: number; quotaBytes: number }

export { selectLockedQuotaState, uploadWouldExceedQuota }

export function uploadQuotaExceededResponse(
  c: Context,
  result: Extract<UploadQuotaResult, { ok: false }>,
) {
  return c.json(
    {
      error: "Storage quota exceeded",
      usedBytes: result.usedBytes,
      quotaBytes: result.quotaBytes,
    },
    413,
  )
}

export function uploadQuotaResult({
  quotaBytes,
  usedBytes,
  reservedBytes,
  incomingBytes,
}: {
  quotaBytes: number | null
  usedBytes: number
  reservedBytes?: number
  incomingBytes: number
}): UploadQuotaResult {
  if (
    quotaBytes !== null &&
    uploadWouldExceedQuota({
      quotaBytes,
      usedBytes,
      reservedBytes,
      incomingBytes,
    })
  ) {
    return { ok: false, usedBytes, quotaBytes }
  }
  return { ok: true }
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
