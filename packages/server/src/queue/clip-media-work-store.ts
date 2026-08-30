import { randomUUID } from "node:crypto"

import { clip } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { publishClipUpsertById } from "@alloy/server/clips/events"
import { client, db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import type { FingerprintSourceFacts } from "@alloy/server/media/encode-fingerprint"
import { cleanupTickets } from "@alloy/server/uploads/tickets"
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"

import { clipMediaRetryDelayMs } from "./clip-media-policy"
import type { MediaGeneration } from "./media-generation"
import type { MediaRow } from "./media-store"

const logger = createLogger("media-worker")
const MAX_ATTEMPTS = 3

const clearedStageColumns = {
  encode_stage: null,
  encode_tier: null,
  encode_tier_index: null,
  encode_tier_count: null,
}

const mediaClaimSelect = {
  id: clip.id,
  authorId: clip.author_id,
  status: clip.status,
  sourceKey: clip.source_key,
  sourceContentType: clip.source_content_type,
  sourceSizeBytes: clip.source_size_bytes,
  sourceDurationMs: clip.source_duration_ms,
  pendingAudioTracks: clip.pending_audio_tracks,
  audioTrackFingerprint: clip.audio_track_fingerprint,
  cutKey: clip.cut_key,
  thumbKey: clip.thumb_key,
  thumbBlurHash: clip.thumb_blur_hash,
  thumbFailedAt: clip.thumb_failed_at,
  trimStartMs: clip.trim_start_ms,
  trimEndMs: clip.trim_end_ms,
  durationMs: clip.duration_ms,
  encodeAttempt: clip.encode_attempt,
  encodeFingerprint: clip.encode_fingerprint,
  encodeFailedFingerprint: clip.encode_failed_fingerprint,
  encodeGeneration: clip.encode_generation,
  encodeFailedGeneration: clip.encode_failed_generation,
  height: clip.height,
  sourceFps: clip.source_fps,
} as const

export interface ClipMediaClaim {
  id: string
  runId: string
  requestId: string
  targetGeneration: number
  force: boolean
  status: typeof clip.$inferSelect.status
  row: MediaRow
  encodeFingerprint: string | null
  encodeFailedFingerprint: string | null
  encodeGeneration: number
  encodeFailedGeneration: number | null
  facts: FingerprintSourceFacts | null
}

export interface RequestClipMediaOptions {
  force: boolean
  priority: number
  requireIdle?: boolean
  clearFailure?: boolean
  tx?: DbTransaction
}

export type RequeueClipMediaResult =
  | { ok: true }
  | { ok: false; reason: "active-run" | "missing" }

interface RawClaim {
  id: string
  encode_request_id: string
  encode_request_force: boolean
}

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
      failure_reason: options.clearFailure ? null : undefined,
      encode_failed_fingerprint: options.clearFailure ? null : undefined,
      encode_failed_generation: options.clearFailure ? null : undefined,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(clip.id, clipId),
        options.requireIdle ? isNull(clip.encode_run_id) : undefined,
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
    ? { ok: false, reason: "active-run" }
    : { ok: false, reason: "missing" }
}

export async function retryClipMediaFailure(clipId: string): Promise<boolean> {
  const requestId = randomUUID()
  const [row] = await db
    .update(clip)
    .set({
      ...clearedStageColumns,
      status: sql`case when ${clip.status} = 'failed' then 'processing' else ${clip.status} end`,
      encode_progress: 0,
      encode_attempt: 0,
      encode_request_id: requestId,
      encode_request_force: true,
      encode_requested_at: sql`now()`,
      encode_run_after: sql`now()`,
      encode_priority: 10,
      encode_claimed_request_id: null,
      encode_failed_fingerprint: null,
      encode_failed_generation: null,
      failure_reason: null,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(clip.id, clipId),
        inArray(clip.status, ["ready", "failed"]),
        isNull(clip.encode_request_id),
        isNull(clip.encode_run_id),
        isNotNull(clip.encode_failed_generation),
      ),
    )
    .returning({ id: clip.id })
  if (!row) return false
  void publishClipUpsertById(clipId)
  return true
}

export async function discardClipMediaFailure(
  clipId: string,
  currentGeneration: number,
): Promise<boolean> {
  const [row] = await db
    .update(clip)
    .set({
      // Acknowledge this desired generation without claiming that its
      // fingerprint succeeded. A later config generation or explicit retry
      // can still re-arm the clip.
      encode_generation: currentGeneration,
      encode_failed_generation: null,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(clip.id, clipId),
        isNull(clip.encode_request_id),
        isNull(clip.encode_run_id),
        isNotNull(clip.encode_failed_generation),
        or(
          eq(clip.status, "failed"),
          eq(clip.encode_failed_generation, currentGeneration),
        ),
      ),
    )
    .returning({ id: clip.id })
  return Boolean(row)
}

export async function claimClipMedia(
  generation: MediaGeneration,
  excludedClipIds: readonly string[] = [],
): Promise<ClipMediaClaim | null> {
  const runId = randomUUID()
  const explicit = await claimExplicit(runId, excludedClipIds)
  const claimed =
    explicit ?? (await claimReconciliation(runId, generation, excludedClipIds))
  if (!claimed) return null

  const [selected] = await db
    .select(mediaClaimSelect)
    .from(clip)
    .where(and(eq(clip.id, claimed.id), eq(clip.encode_run_id, runId)))
    .limit(1)
  if (!selected) return null

  return {
    id: selected.id,
    runId,
    requestId: claimed.encode_request_id,
    targetGeneration: generation.generation,
    force:
      claimed.encode_request_force ||
      selected.encodeGeneration < generation.forceGeneration,
    status: selected.status,
    row: selected,
    encodeFingerprint: selected.encodeFingerprint,
    encodeFailedFingerprint: selected.encodeFailedFingerprint,
    encodeGeneration: selected.encodeGeneration,
    encodeFailedGeneration: selected.encodeFailedGeneration,
    facts:
      selected.height === null || selected.sourceFps === null
        ? null
        : {
            height: selected.height,
            sourceFps: selected.sourceFps,
            trimStartMs: selected.trimStartMs,
            trimEndMs: selected.trimEndMs,
            audioTrackFingerprint: selected.audioTrackFingerprint,
          },
  }
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

export async function nextClipMediaRunAt(
  excludedClipIds: readonly string[] = [],
): Promise<Date | null> {
  const result = await client.query<{ next_run_at: Date | null }>(
    `
    select min(
      case
        when c.encode_run_id is null
          or c.encode_locked_at is null
          or c.encode_locked_at < now() - interval '2 minutes'
          then coalesce(c.encode_run_after, now())
        else greatest(
          coalesce(c.encode_run_after, now()),
          c.encode_locked_at + interval '2 minutes'
        )
      end
    ) as next_run_at
    from clip c
    where c.encode_request_id is not null
      and c.status in ('processing', 'ready')
      and not (c.id = any($1::uuid[]))
  `,
    [excludedClipIds],
  )
  return result.rows[0]?.next_run_at ?? null
}

export async function clipMediaAdminQueueCounts(
  generation: number | null,
): Promise<{
  pending: number
  running: number
  failed: number
  completed: number
}> {
  const implicitPending =
    generation === null
      ? sql`false`
      : sql`(
          ${clip.status} = 'ready'
          and ${clip.source_key} is not null
          and ${clip.encode_request_id} is null
          and (
            (
              ${clip.encode_generation} <> ${generation}
              and ${clip.encode_failed_generation} is distinct from ${generation}
            )
            or (
              ${clip.encode_generation} = ${generation}
              and ${clip.thumb_key} is null
              and ${clip.thumb_failed_at} is null
            )
          )
        )`
  const visibleFailure =
    generation === null
      ? sql`${clip.encode_failed_generation} is not null`
      : sql`(
          ${clip.encode_failed_generation} is not null
          and (
            ${clip.status} = 'failed'
            or ${clip.encode_failed_generation} = ${generation}
          )
        )`
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where
        ${clip.encode_run_id} is null
        and (
          (
            ${clip.encode_request_id} is not null
            and ${clip.status} in ('processing', 'ready')
          )
          or ${implicitPending}
        )
      )::int`,
      running: sql<number>`count(*) filter (where
        ${clip.encode_run_id} is not null
      )::int`,
      failed: sql<number>`count(*) filter (where
        ${clip.encode_request_id} is null
        and ${clip.encode_run_id} is null
        and ${visibleFailure}
      )::int`,
    })
    .from(clip)
  return {
    pending: counts?.pending ?? 0,
    running: counts?.running ?? 0,
    failed: counts?.failed ?? 0,
    // Direct clip state intentionally has no unbounded completion history.
    completed: 0,
  }
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
      audioTrackFingerprint: clip.audio_track_fingerprint,
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
    audioTrackFingerprint: row.audioTrackFingerprint,
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
      ...completeRequestColumns(claim.requestId),
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
  const result = await db.transaction(async (tx) => {
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
    if (!current) return { outcome: "lost" as const, terminalStatus: null }

    if (current.requestId !== claim.requestId) {
      await releaseRun(tx, claim, reason)
      return { outcome: "superseded" as const, terminalStatus: null }
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
        .where(and(eq(clip.id, claim.id), eq(clip.encode_run_id, claim.runId)))
      return { outcome: "retry" as const, terminalStatus: null }
    }

    const terminalStatus = current.status === "ready" ? "ready" : "failed"
    await tx
      .update(clip)
      .set({
        ...clearedStageColumns,
        ...completeRequestColumns(claim.requestId),
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
    return { outcome: "failed" as const, terminalStatus }
  })

  if (result.outcome !== "failed") return result.outcome
  if (result.terminalStatus === "failed") {
    await cleanupTickets(
      { type: "clip", id: claim.id },
      `terminal clip ${claim.id} upload`,
    ).catch((err) =>
      logger.error(`failed to clean terminal clip uploads:`, err),
    )
  }
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

function completeRequestColumns(requestId: string) {
  const ownsRequest = sql`${clip.encode_request_id} = ${requestId}`
  return {
    encode_request_id: sql`case when ${ownsRequest} then null else ${clip.encode_request_id} end`,
    encode_request_force: sql`case when ${ownsRequest} then false else ${clip.encode_request_force} end`,
    encode_requested_at: sql`case when ${ownsRequest} then null else ${clip.encode_requested_at} end`,
    encode_run_after: sql`case when ${ownsRequest} then null else ${clip.encode_run_after} end`,
    encode_priority: sql`case when ${ownsRequest} then 90 else ${clip.encode_priority} end`,
    encode_claimed_request_id: null,
  }
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

async function claimExplicit(
  runId: string,
  excludedClipIds: readonly string[],
): Promise<RawClaim | null> {
  const result = await client.query<RawClaim>(
    `
      with candidate as (
        select c.id
        from clip c
        where c.encode_request_id is not null
          and c.status in ('processing', 'ready')
          and not (c.id = any($2::uuid[]))
          and c.encode_run_after <= now()
          and (
            c.encode_run_id is null
            or c.encode_locked_at is null
            or c.encode_locked_at < now() - interval '2 minutes'
          )
        order by
          c.encode_priority asc,
          c.encode_run_after asc,
          c.encode_requested_at asc,
          c.id asc
        limit 1
        for update skip locked
      )
      update clip c
      set
        encode_run_id = $1::uuid,
        encode_locked_at = now(),
        encode_claimed_request_id = c.encode_request_id,
        encode_attempt = case
          when c.encode_claimed_request_id = c.encode_request_id
            then c.encode_attempt + 1
          else 1
        end,
        status = case when c.status = 'ready' then 'ready' else 'processing' end,
        failure_reason = null,
        updated_at = now()
      from candidate
      where c.id = candidate.id
      returning c.id, c.encode_request_id, c.encode_request_force
    `,
    [runId, excludedClipIds],
  )
  return result.rows[0] ?? null
}

async function claimReconciliation(
  runId: string,
  generation: MediaGeneration,
  excludedClipIds: readonly string[],
): Promise<RawClaim | null> {
  const requestId = randomUUID()
  const result = await client.query<RawClaim>(
    `
      with candidate as (
        select c.id
        from clip c
        where c.status = 'ready'
          and c.source_key is not null
          and c.encode_request_id is null
          and not (c.id = any($5::uuid[]))
          and (
            c.encode_run_id is null
            or c.encode_locked_at is null
            or c.encode_locked_at < now() - interval '2 minutes'
          )
          and (
            (
              c.encode_generation <> $3::int
              and c.encode_failed_generation is distinct from $3::int
            )
            or (
              c.encode_generation = $3::int
              and c.thumb_key is null
              and c.thumb_failed_at is null
            )
          )
        order by c.encode_generation asc, c.id asc
        limit 1
        for update skip locked
      )
      update clip c
      set
        encode_request_id = $2::uuid,
        encode_request_force = c.encode_generation < $4::int,
        encode_requested_at = now(),
        encode_run_after = now(),
        encode_priority = 90,
        encode_claimed_request_id = $2::uuid,
        encode_run_id = $1::uuid,
        encode_locked_at = now(),
        encode_attempt = 1,
        failure_reason = null,
        updated_at = now()
      from candidate
      where c.id = candidate.id
      returning c.id, c.encode_request_id, c.encode_request_force
    `,
    [
      runId,
      requestId,
      generation.generation,
      generation.forceGeneration,
      excludedClipIds,
    ],
  )
  return result.rows[0] ?? null
}
