import type {
  ClipAudioTrackInput,
  ClipAudioTrackKind,
  EncodeStage,
} from "@alloy/contracts"
import type { UploadTicketTarget } from "@alloy/db/schema"

/** The media-bearing subset of a recording row the processing run reads. */
export interface MediaRow {
  id: string
  authorId: string
  sourceKey: string | null
  sourceContentType: string | null
  sourceAudioCodec: string | null
  sourceSizeBytes: number | null
  sourceDurationMs: number | null
  waveformKey: string | null
  pendingAudioTracks: ClipAudioTrackInput[] | null
  audioTrackFingerprint: string | null
  cutKey: string | null
  thumbKey: string | null
  thumbBlurHash: string | null
  thumbFailedAt: Date | null
  trimStartMs: number | null
  trimEndMs: number | null
  durationMs: number | null
  encodeAttempt: number
}

export interface MediaSourcePatch {
  sourceKey: string
  sourceContentType: string
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  sourceCodecs: string | null
  sourceFps: number
  sourceSizeBytes: number
  sourceDurationMs: number
  waveformKey: string | null
  pendingAudioTracks: ClipAudioTrackInput[] | null
  audioTrackFingerprint: string | null
  cutKey: string | null
  /** RFC 6381 codecs of the committed cut; null when `cutKey` is null. */
  cutCodecs: string | null
  durationMs: number
  width: number
  height: number
}

export interface MediaThumbPatch {
  thumbKey: string | null
  thumbBlurHash: string | null
  thumbFailedAt?: Date | null
}

export interface MediaStageTier {
  name: string
  index: number
  count: number
}

/** One encoded quality tier produced by a media run. */
export interface MediaRenditionRecord {
  /** Stable per-tier slug derived from height/fps/codec, e.g. "1080p60". */
  name: string
  /** Whether this rendition powers OpenGraph/social embeds. */
  isOg: boolean
  height: number
  width: number
  fps: number
  storageKey: string
  codecs: string
  sizeBytes: number
}

/** One extracted per-source audio track produced by a media run. */
export interface MediaAudioTrackRecord {
  index: number
  kind: ClipAudioTrackKind
  label: string
  storageKey: string
  codecs: string
  sizeBytes: number
}

export interface MediaCompletion {
  requestId: string
  targetGeneration: number
}

/**
 * Table-specific glue for the media pipeline. Every write is guarded by the
 * encode runId and returns false/null once the run has moved on
 * (stale-takeover safe).
 */
export interface MediaStore {
  /** Distinguishes the worker instances and scopes upload tickets. */
  readonly target: UploadTicketTarget

  /** True while the row still holds this run's lease. */
  stillPresent(id: string, runId: string): Promise<boolean>
  /** Reset progress at the start of the run body; false if lease lost. */
  beginProcessing(id: string, runId: string): Promise<boolean>
  /** Persist active encode stage labels, guarded by runId. */
  commitStage(
    id: string,
    runId: string,
    stage: EncodeStage,
    tier?: MediaStageTier,
  ): Promise<boolean>
  /** Persist a progress %, guarded by runId; true if the row advanced. */
  commitProgress(id: string, runId: string, pct: number): Promise<boolean>
  /** Side-channel progress signal (SSE for clips). */
  publishProgress(authorId: string, id: string, pct: number): void
  /** Commit source facts plus the current materialized cut reference. */
  commitSource(
    id: string,
    runId: string,
    patch: MediaSourcePatch,
  ): Promise<boolean>
  /** Commit the poster; false if lease lost. */
  commitThumb(
    id: string,
    runId: string,
    patch: MediaThumbPatch,
  ): Promise<boolean>
  /** Commit a compact waveform source and release an asset-only run. */
  commitWaveform(
    id: string,
    runId: string,
    waveformKey: string | null,
    completion: MediaCompletion,
  ): Promise<boolean>
  /** Clear a thumbnail-only run after success. */
  finishThumbnailBackfill(
    id: string,
    runId: string,
    completion: MediaCompletion,
  ): Promise<boolean>
  /** Mark content as permanently unsuitable for poster extraction. */
  commitThumbFailed(
    id: string,
    runId: string,
    completion: MediaCompletion,
  ): Promise<boolean>
  /**
   * Transitions the row to publicly playable once source and thumbnail state
   * are committed, while the encode ladder continues under the same lease.
   * This is the eager-release moment: when the clip is public it also stamps
   * `published_at` (write-once) since the clip is now feed-visible. Does not
   * touch encode_progress; only commitReady owns the full encode result.
   */
  commitPlayable(id: string, runId: string): Promise<boolean>
  /**
   * Transactional replacement keeps readers from seeing partial ladders.
   * Stamps `published_at` under the same rule as commitPlayable, covering
   * retried runs whose source (and thus playable transition) predates them.
   */
  commitReady(
    id: string,
    runId: string,
    patch: MediaSourcePatch &
      MediaThumbPatch & {
        encodeFingerprint: string
      },
    renditions: readonly MediaRenditionRecord[],
    audioTracks: readonly MediaAudioTrackRecord[],
    completion: MediaCompletion,
  ): Promise<boolean>
  /** Current asset keys, so a failing run never deletes live assets. */
  currentAssetKeys(id: string): Promise<{
    sourceKey: string | null
    waveformKey: string | null
    cutKey: string | null
    thumbKey: string | null
    renditionKeys: string[]
    audioTrackKeys: string[]
  } | null>

  publishUpsert(authorId: string, id: string): void
}
