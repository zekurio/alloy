import type { ClipGameRef } from "./content-games"
import type { UserSummary } from "./content-users"
import type {
  AcceptedMediaContentType,
  MediaKind,
  MediaFilter,
  ClipPrivacy,
  ClipStatus,
  IsoDateString,
  UploadTicket,
} from "./shared"

export type ClipMentionRef = UserSummary

/** One encoded quality tier of a clip, as exposed to clients. */
export interface ClipRenditionRef {
  /** Stable per-tier slug like "1080p" or "1080p60-hevc"; keys rendition URLs. */
  name: string
  height: number
  width: number
  fps: number
  /** RFC 6381 codec string for canPlayType filtering and quality-label disambiguation. */
  codecs: string
  /** Cache-busting version of this tier's file bytes; changes on re-encode. */
  version: string
}

export const ENCODE_STAGE = [
  "downloading",
  "processing",
  "encoding",
  "finalizing",
] as const
export type EncodeStage = (typeof ENCODE_STAGE)[number]

export interface ClipRow {
  mediaKind: MediaKind
  id: string
  authorId: string
  title: string
  description: string | null
  game: string | null
  gameId: string | null
  privacy: ClipPrivacy
  sourceContentType: string | null
  /** MIME type of the default playback bytes (`/source/file`): video/mp4 when a derived trim cut shadows the source, else the source content type. Null while nothing playable is committed. */
  playbackContentType: string | null
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  sourceCodecs: string | null
  sourceSizeBytes: number | null
  sourceDurationMs: number | null
  /** Cache-busting version of the published source bytes; changes on republish. */
  sourceVersion: string | null
  /** Cache-busting version of the compact waveform audio, when available. */
  waveformVersion: string | null
  /** Encoded quality tiers, highest first; empty until the pipeline commits. */
  renditions: ClipRenditionRef[]
  durationMs: number | null
  width: number | null
  height: number | null
  thumbKey: string | null
  thumbVersion: string | null
  thumbBlurHash: string | null
  viewCount: number
  trimStartMs: number | null
  trimEndMs: number | null
  status: ClipStatus
  /**
   * True while media encoding is queued or running. A ready clip keeps serving
   * its committed media while this is true.
   */
  encodeActive: boolean
  encodeProgress: number
  encodeStage: EncodeStage | null
  encodeTier: string | null
  encodeTierIndex: number | null
  encodeTierCount: number | null
  failureReason: string | null
  createdAt: IsoDateString
  /**
   * First moment the clip became publicly listed (ready + public); null while
   * it has never been published. Feeds order by this, not createdAt, so a
   * slow encode doesn't backdate the clip.
   */
  publishedAt: IsoDateString | null
  updatedAt: IsoDateString
  authorUsername: string
  authorDisplayName: string | null
  authorImage: string | null
  gameRef: ClipGameRef | null
  mentions?: ClipMentionRef[]
  /** Bare, lowercase-canonical hashtags ("ace", "ranked"). */
  tags: string[]
}

export type ClipListSort = "top" | "recent"
export type ClipFeedSort = ClipListSort | "recommended"

export const CLIP_TITLE_MAX_LENGTH = 100
export const CLIP_DESCRIPTION_MAX_LENGTH = 2000

export interface ClipPage {
  items: ClipRow[]
  nextCursor: string | null
}

export interface ProfileMediaParams {
  tab?: "all" | "tagged"
  media?: MediaFilter
  sort?: "recent" | "oldest" | "views"
  game?: string
  limit?: number
  offset?: number
}

export interface InitiateClipInput {
  /**
   * Client-generated clip ID for optimistic local queue rows. The server still
   * validates uniqueness and may reject a collision.
   */
  clientClipId?: string
  filename: string
  contentType: AcceptedMediaContentType
  sizeBytes: number
  title: string
  description?: string
  /** Surrogate id of the attached game (SteamGridDB or custom); resolved client-side. */
  gameId?: string | null
  privacy?: ClipPrivacy
  mentionedUserIds?: string[]
  /** Bare hashtags; normalized server-side. */
  tags?: string[]
  /**
   * Client-probed source dimensions and duration; shape placeholders while
   * the clip processes. Media processing re-probes and overwrites them.
   */
  width?: number
  height?: number
  durationMs?: number
  /**
   * Kept source range in the uploaded file's timeline. The raw upload is
   * stored untouched; the media run derives the cut server-side. Both bounds
   * or neither.
   */
  trimStartMs?: number
  trimEndMs?: number
}

/**
 * Clip thumbnails are generated server-side during media processing. A clip may
 * temporarily have no thumbnail while processing, or permanently when no
 * non-uniform poster frame can be extracted.
 */
export interface InitiateClipResponse {
  clipId: string
  ticket: UploadTicket
}

export interface UpdateClipInput {
  title?: string
  description?: string
  gameId?: string | null
  privacy?: ClipPrivacy
  mentionedUserIds?: string[]
  tags?: string[]
}

/**
 * Owner-requested destructive trim of an uploaded clip's media, in source
 * time. The server cuts the stored source to this range and reprocesses the
 * clip's derived assets.
 */
export interface TrimClipInput {
  startMs: number
  endMs: number
}

/**
 * Re-poster request: extract the frame at `timeMs` (source-time; the server
 * clamps it into the trim range) and publish it as the clip's thumbnail.
 */
export interface SetClipPosterInput {
  timeMs: number
}

export interface QueueClip {
  id: string
  title: string
  status: ClipStatus
  /** See {@link ClipRow.encodeActive}. */
  encodeActive: boolean
  encodeProgress: number
  encodeStage: EncodeStage | null
  encodeTier: string | null
  encodeTierIndex: number | null
  encodeTierCount: number | null
  failureReason: string | null
  hasThumb: boolean
  thumbVersion: string | null
  thumbBlurHash: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
  gameId: string | null
  gameSlug: string | null
}

export type QueueEvent =
  | { type: "upsert"; clip: QueueClip }
  | { type: "progress"; id: string; encodeProgress: number }
  | { type: "remove"; id: string }
