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
  cutKey: string | null
  thumbKey: string | null
  thumbBlurHash: string | null
  thumbFailedAt: Date | null
  thumbTimeMs: number | null
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
  sourceFps: number | null
  sourceSizeBytes: number
  sourceDurationMs: number | null
  waveformKey: string | null
  cutKey: string | null
  /** RFC 6381 codecs of the committed cut; null when `cutKey` is null. */
  cutCodecs: string | null
  durationMs: number | null
  width: number
  height: number
}

export interface MediaThumbPatch {
  thumbKey: string | null
  thumbBlurHash: string | null
  thumbFailedAt?: Date | null
  /** Source time of the frame an owner picked; null for automatic posters. */
  thumbTimeMs: number | null
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

export interface MediaCompletion {
  requestId: string
  targetGeneration: number
}
