import { randomUUID } from "node:crypto"

import { clip } from "@alloy/db/schema"
import { client, db } from "@alloy/server/db/index"
import type { FingerprintSourceFacts } from "@alloy/server/media/encode-fingerprint"
import { and, eq } from "drizzle-orm"

import type { MediaGeneration } from "./media-generation"
import type { MediaRow } from "./media-store"

const mediaClaimSelect = {
  id: clip.id,
  authorId: clip.author_id,
  status: clip.status,
  sourceKey: clip.source_key,
  sourceContentType: clip.source_content_type,
  sourceAudioCodec: clip.source_audio_codec,
  sourceSizeBytes: clip.source_size_bytes,
  sourceDurationMs: clip.source_duration_ms,
  waveformKey: clip.waveform_key,
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

interface RawClaim {
  id: string
  encode_request_id: string
  encode_request_force: boolean
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
          },
  }
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
        where c.status = 'ready' and c.media_kind = 'video'
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
            or (
              (c.source_audio_codec is not null)
              <> (c.waveform_key is not null)
              and c.encode_failed_generation is distinct from $3::int
            )
            or (
              (
                (c.trim_start_ms is not null and c.trim_end_ms is not null)
                <> (c.cut_key is not null)
              )
              and c.encode_failed_generation is distinct from $3::int
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
