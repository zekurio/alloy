import { clip } from "@alloy/db/schema"
import { sql } from "drizzle-orm"

import type {
  MediaCompletion,
  MediaSourcePatch,
  MediaThumbPatch,
} from "./media-store"

export const clearedStageColumns = {
  encode_stage: null,
  encode_tier: null,
  encode_tier_index: null,
  encode_tier_count: null,
}

// Write-once publish stamp: only public rows get one, and the first transition
// to (ready + public) wins so a privacy round-trip can't bump feed position.
export const publishedAtStamp = sql`coalesce(${clip.published_at}, case when ${clip.privacy} = 'public' then now() end)`

export function sourcePatchToColumns(patch: MediaSourcePatch) {
  return {
    source_key: patch.sourceKey,
    source_content_type: patch.sourceContentType,
    source_video_codec: patch.sourceVideoCodec,
    source_audio_codec: patch.sourceAudioCodec,
    source_codecs: patch.sourceCodecs,
    source_fps: patch.sourceFps,
    source_size_bytes: patch.sourceSizeBytes,
    source_duration_ms: patch.sourceDurationMs,
    waveform_key: patch.waveformKey,
    cut_key: patch.cutKey,
    cut_codecs: patch.cutCodecs,
    duration_ms: patch.durationMs,
    width: patch.width,
    height: patch.height,
    thumb_failed_at: null,
  }
}

export function thumbPatchToColumns(patch: MediaThumbPatch) {
  const columns = {
    thumb_key: patch.thumbKey,
    thumb_blur_hash: patch.thumbBlurHash,
  }
  if (patch.thumbFailedAt === undefined && patch.thumbKey) {
    return { ...columns, thumb_failed_at: null }
  }
  if (patch.thumbFailedAt === undefined) return columns
  return { ...columns, thumb_failed_at: patch.thumbFailedAt }
}

export function completeRequestColumns(completion: MediaCompletion) {
  const ownsRequest = sql`${clip.encode_request_id} = ${completion.requestId}`
  return {
    encode_request_id: sql`case when ${ownsRequest} then null else ${clip.encode_request_id} end`,
    encode_request_force: sql`case when ${ownsRequest} then false else ${clip.encode_request_force} end`,
    encode_requested_at: sql`case when ${ownsRequest} then null else ${clip.encode_requested_at} end`,
    encode_run_after: sql`case when ${ownsRequest} then null else ${clip.encode_run_after} end`,
    encode_priority: sql`case when ${ownsRequest} then 90 else ${clip.encode_priority} end`,
    encode_claimed_request_id: null,
  }
}
