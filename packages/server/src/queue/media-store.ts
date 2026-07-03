import type { UploadTicketTarget } from "@alloy/db/schema"

/** The media-bearing subset of a recording row the processing run reads. */
export interface MediaRow {
  id: string
  authorId: string
  sourceKey: string | null
  sourceContentType: string | null
  sourceSizeBytes: number | null
  thumbKey: string | null
  thumbBlurHash: string | null
  trimStartMs: number | null
  trimEndMs: number | null
  encodeAttempt: number
}

export interface MediaSourcePatch {
  sourceKey: string
  sourceContentType: string
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  sourceCodecs: string | null
  sourceSizeBytes: number
  sourceDurationMs: number
  durationMs: number
  width: number
  height: number
}

export interface MediaThumbPatch {
  thumbKey: string | null
  thumbBlurHash: string | null
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

/**
 * Table-specific glue for the media pipeline. The lease loop
 * ({@link createMediaWorker}) and the processing run ({@link runMediaProcessing})
 * are written once against this interface. Every write is guarded by the encode
 * runId and returns false/null once the lease has moved on (stale-takeover safe).
 */
export interface MediaStore {
  /** Distinguishes the worker instances and scopes upload tickets. */
  readonly target: UploadTicketTarget

  /** Next leasable id (status/lease/retry-delay eligible) not already in flight. */
  selectNextLeasableId(inFlight: ReadonlySet<string>): Promise<string | null>
  /** Atomically take the lease (processing + runId + lockedAt + attempt++). */
  lease(id: string, runId: string): Promise<MediaRow | null>
  /** Refresh the lease; false means another run took over. */
  heartbeat(id: string, runId: string): Promise<boolean>
  /** Clear the lease (leaving status) so the row is retried later. */
  releaseLease(id: string, runId: string, reason: string): Promise<void>
  /** Terminal failure (unless already ready); cleans tickets. */
  markFailed(id: string, reason: string): Promise<void>

  /** True while the row still holds this run's lease. */
  stillPresent(id: string, runId: string): Promise<boolean>
  /** Reset progress at the start of the run body; false if lease lost. */
  beginProcessing(id: string, runId: string): Promise<boolean>
  /** Persist a progress %, guarded by runId; true if the row advanced. */
  commitProgress(id: string, runId: string, pct: number): Promise<boolean>
  /** Side-channel progress signal (SSE for clips). */
  publishProgress(authorId: string, id: string, pct: number): void
  /** Commit the (possibly trimmed) source asset; false if lease lost. */
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
  /**
   * Final ready transition. Replaces the row's rendition set in the same
   * transaction so readers never observe a half-committed ladder.
   */
  commitReady(
    id: string,
    runId: string,
    patch: MediaSourcePatch & MediaThumbPatch,
    renditions: readonly MediaRenditionRecord[],
  ): Promise<boolean>
  /** Current asset keys, so a failing run never deletes live assets. */
  currentAssetKeys(id: string): Promise<{
    sourceKey: string | null
    thumbKey: string | null
    renditionKeys: string[]
  } | null>

  publishUpsert(authorId: string, id: string): void
}
