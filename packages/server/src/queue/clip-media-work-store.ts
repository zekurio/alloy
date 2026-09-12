import { randomUUID } from "node:crypto"

import { clip } from "@alloy/db/schema"
import { publishClipUpsertById } from "@alloy/server/clips/events"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import type { FingerprintSourceFacts } from "@alloy/server/media/encode-fingerprint"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { withUploadActivityStopped } from "@alloy/server/uploads/activity"
import { deleteUploadTicketsWithStorageIntents } from "@alloy/server/uploads/tickets"
import { and, eq, isNull, sql } from "drizzle-orm"

import type { ClipMediaClaim } from "./clip-media-claim-store"
import { clipMediaRetryDelayMs } from "./clip-media-policy"
import {
  clearedStageColumns,
  completeRequestColumns,
} from "./clip-media-store-columns"

const MAX_ATTEMPTS = 3

export interface RequestClipMediaOptions {
  force: boolean
  priority: number
  requireIdle?: boolean
  clearFailure?: boolean
  tx?: DbTransaction
}

export type RequeueClipMediaResult =
  | { ok: true }
  | { ok: false; reason: "active-work" | "missing" }

export async function requestClipMedia(
  clipId: string,
  options: RequestClipMediaOptions,
): Promise<boolean> {
  const executor = options.tx ?? db
  const requestId = randomUUID()
  const [row] = await executor
    .update(clip)
    .set({
      encode_request_id: requestId,
      encode_request_force: sql`case when ${clip.encode_request_id} is null then ${options.force} else ${clip.encode_request_force} or ${options.force} end`,
      encode_requested_at: sql`coalesce(${clip.encode_requested_at}, now())`,
      encode_run_after: sql`now()`,
      encode_priority: sql`case when ${clip.encode_request_id} is null then ${options.priority} else least(${clip.encode_priority}, ${options.priority}) end`,
      encode_claimed_request_id: sql`case when ${clip.encode_run_id} is null then null else ${clip.encode_claimed_request_id} end`,
      encode_attempt: sql`case when ${clip.encode_run_id} is null then 0 else ${clip.encode_attempt} end`,
      // Queue state and progress move together. In particular, ready clips must
      // not rely on a later progress reset that can race the worker's commit.
      encode_progress: sql`case when ${clip.encode_run_id} is null then 0 else ${clip.encode_progress} end`,
      encode_stage: sql`case when ${clip.encode_run_id} is null then null else ${clip.encode_stage} end`,
      encode_tier: sql`case when ${clip.encode_run_id} is null then null else ${clip.encode_tier} end`,
      encode_tier_index: sql`case when ${clip.encode_run_id} is null then null else ${clip.encode_tier_index} end`,
      encode_tier_count: sql`case when ${clip.encode_run_id} is null then null else ${clip.encode_tier_count} end`,
      failure_reason: options.clearFailure ? null : undefined,
      encode_failed_fingerprint: options.clearFailure ? null : undefined,
      encode_failed_generation: options.clearFailure ? null : undefined,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(clip.id, clipId),
        options.requireIdle
          ? and(isNull(clip.encode_request_id), isNull(clip.encode_run_id))
          : undefined,
      ),
    )
    .returning({ id: clip.id })
  return Boolean(row)
}

export async function requeueClipMedia(
  clipId: string,
  options: Pick<RequestClipMediaOptions, "clearFailure" | "force" | "priority">,
): Promise<RequeueClipMediaResult> {
  if (
    await requestClipMedia(clipId, {
      ...options,
      requireIdle: true,
    })
  ) {
    return { ok: true }
  }
  const [row] = await db
    .select({ id: clip.id })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  return row
    ? { ok: false, reason: "active-work" }
    : { ok: false, reason: "missing" }
}

export async function heartbeatClipMedia(
  claim: ClipMediaClaim,
): Promise<boolean> {
  const [row] = await db
    .update(clip)
    .set({ encode_locked_at: sql`now()` })
    .where(and(eq(clip.id, claim.id), eq(clip.encode_run_id, claim.runId)))
    .returning({ id: clip.id })
  return Boolean(row)
}

export async function clipMediaClaimCompleted(
  claim: ClipMediaClaim,
): Promise<boolean> {
  const [row] = await db
    .select({
      status: clip.status,
      generation: clip.encode_generation,
      requestId: clip.encode_request_id,
      claimedRequestId: clip.encode_claimed_request_id,
      runId: clip.encode_run_id,
    })
    .from(clip)
    .where(eq(clip.id, claim.id))
    .limit(1)
  return (
    row?.status === "ready" &&
    row.generation >= claim.targetGeneration &&
    row.runId === null &&
    row.claimedRequestId === null &&
    row.requestId !== claim.requestId
  )
}

export async function selectClipMediaFacts(
  clipId: string,
): Promise<FingerprintSourceFacts | null> {
  const [row] = await db
    .select({
      height: clip.height,
      sourceFps: clip.source_fps,
      trimStartMs: clip.trim_start_ms,
      trimEndMs: clip.trim_end_ms,
    })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  if (!row || row.height === null || row.sourceFps === null) return null
  return {
    height: row.height,
    sourceFps: row.sourceFps,
    trimStartMs: row.trimStartMs,
    trimEndMs: row.trimEndMs,
  }
}

export async function completeClipMediaWithoutPipeline(
  claim: ClipMediaClaim,
  options: { quarantined?: boolean } = {},
): Promise<boolean> {
  const [row] = await db
    .update(clip)
    .set({
      ...clearedStageColumns,
      ...completeRequestColumns(claim),
      encode_generation: options.quarantined
        ? clip.encode_generation
        : claim.targetGeneration,
      encode_failed_generation: options.quarantined
        ? claim.targetGeneration
        : null,
      encode_progress: options.quarantined ? clip.encode_progress : 100,
      encode_run_id: null,
      encode_locked_at: null,
      updated_at: sql`now()`,
    })
    .where(and(eq(clip.id, claim.id), eq(clip.encode_run_id, claim.runId)))
    .returning({ id: clip.id })
  return Boolean(row)
}

export async function releaseClipMediaForShutdown(
  claim: ClipMediaClaim,
): Promise<void> {
  await releaseClipMedia(claim, "Media processing interrupted by shutdown")
}

export async function releaseClipMediaForCancellation(
  claim: ClipMediaClaim,
): Promise<void> {
  await releaseClipMedia(claim, "Media processing cancelled for clip mutation")
}

async function releaseClipMedia(
  claim: ClipMediaClaim,
  reason: string,
): Promise<void> {
  await db
    .update(clip)
    .set({
      ...clearedStageColumns,
      encode_run_id: null,
      encode_locked_at: null,
      encode_run_after: sql`case when ${clip.encode_request_id} = ${claim.requestId} then now() else ${clip.encode_run_after} end`,
      failure_reason: reason,
      updated_at: sql`now()`,
    })
    .where(and(eq(clip.id, claim.id), eq(clip.encode_run_id, claim.runId)))
}

export async function failClipMedia(
  claim: ClipMediaClaim,
  reason: string,
  options: {
    encodeFailedFingerprint: string | null
    thumbnailOnly: boolean
  },
): Promise<"retry" | "failed" | "superseded" | "lost"> {
  const result = await withUploadActivityStopped(claim.id, () =>
    db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          requestId: clip.encode_request_id,
          attempt: clip.encode_attempt,
          status: clip.status,
        })
        .from(clip)
        .where(and(eq(clip.id, claim.id), eq(clip.encode_run_id, claim.runId)))
        .limit(1)
        .for("update")
      if (!current) {
        return {
          outcome: "lost" as const,
          terminalStatus: null,
          queuedDeletions: 0,
        }
      }

      if (current.requestId !== claim.requestId) {
        await releaseRun(tx, claim, reason)
        return {
          outcome: "superseded" as const,
          terminalStatus: null,
          queuedDeletions: 0,
        }
      }

      if (current.attempt < MAX_ATTEMPTS) {
        await tx
          .update(clip)
          .set({
            ...clearedStageColumns,
            encode_run_id: null,
            encode_locked_at: null,
            encode_run_after: sql`now() + ${clipMediaRetryDelayMs(current.attempt)} * interval '1 millisecond'`,
            failure_reason: reason.slice(0, 500),
            updated_at: sql`now()`,
          })
          .where(
            and(eq(clip.id, claim.id), eq(clip.encode_run_id, claim.runId)),
          )
        return {
          outcome: "retry" as const,
          terminalStatus: null,
          queuedDeletions: 0,
        }
      }

      const terminalStatus = current.status === "ready" ? "ready" : "failed"
      const [terminal] = await tx
        .update(clip)
        .set({
          ...clearedStageColumns,
          ...completeRequestColumns(claim),
          status: terminalStatus,
          encode_run_id: null,
          encode_locked_at: null,
          encode_failed_fingerprint: options.thumbnailOnly
            ? clip.encode_failed_fingerprint
            : sql`coalesce(${options.encodeFailedFingerprint}, ${clip.encode_failed_fingerprint})`,
          encode_failed_generation: options.thumbnailOnly
            ? clip.encode_failed_generation
            : claim.targetGeneration,
          thumb_failed_at: options.thumbnailOnly
            ? new Date()
            : clip.thumb_failed_at,
          failure_reason: options.thumbnailOnly ? null : reason.slice(0, 500),
          updated_at: sql`now()`,
        })
        .where(and(eq(clip.id, claim.id), eq(clip.encode_run_id, claim.runId)))
        .returning({ id: clip.id })
      if (!terminal) {
        return {
          outcome: "lost" as const,
          terminalStatus: null,
          queuedDeletions: 0,
        }
      }
      const queuedDeletions = await deleteUploadTicketsWithStorageIntents(
        { type: "clip", id: claim.id },
        `terminal clip ${claim.id} upload`,
        tx,
      )
      return {
        outcome: "failed" as const,
        terminalStatus,
        queuedDeletions,
      }
    }),
  )

  if (result.queuedDeletions > 0) wakeStorageDeletionWorker()
  if (result.outcome !== "failed") return result.outcome
  void publishClipUpsertById(claim.id)
  return result.outcome
}

export async function recoverClipMediaWork(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(clip)
      .set({
        ...clearedStageColumns,
        encode_request_id: sql`coalesce(${clip.encode_request_id}, ${clip.encode_claimed_request_id}, gen_random_uuid())`,
        encode_request_force: sql`coalesce(${clip.encode_request_force}, false)`,
        encode_requested_at: sql`coalesce(${clip.encode_requested_at}, now())`,
        encode_run_after: sql`now()`,
        encode_run_id: null,
        encode_locked_at: null,
        updated_at: sql`now()`,
      })
      .where(sql`${clip.encode_run_id} is not null`)

    await tx
      .update(clip)
      .set({
        encode_requested_at: sql`coalesce(${clip.encode_requested_at}, now())`,
        encode_run_after: sql`coalesce(${clip.encode_run_after}, now())`,
        updated_at: sql`now()`,
      })
      .where(
        sql`${clip.encode_request_id} is not null and (${clip.encode_requested_at} is null or ${clip.encode_run_after} is null)`,
      )

    await tx
      .update(clip)
      .set({
        encode_request_id: sql`gen_random_uuid()`,
        encode_request_force: false,
        encode_requested_at: sql`now()`,
        encode_run_after: sql`now()`,
        encode_priority: 10,
        encode_claimed_request_id: null,
        encode_attempt: 0,
        updated_at: sql`now()`,
      })
      .where(and(eq(clip.status, "processing"), isNull(clip.encode_request_id)))
  })
}

async function releaseRun(
  tx: DbTransaction,
  claim: ClipMediaClaim,
  reason: string,
): Promise<void> {
  await tx
    .update(clip)
    .set({
      ...clearedStageColumns,
      encode_run_id: null,
      encode_locked_at: null,
      encode_claimed_request_id: null,
      failure_reason: reason.slice(0, 500),
      updated_at: sql`now()`,
    })
    .where(and(eq(clip.id, claim.id), eq(clip.encode_run_id, claim.runId)))
}
