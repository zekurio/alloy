import type { ClipGameRef } from "./content"
import type {
  AcceptedContentType,
  AcceptedThumbContentType,
  ClipPrivacy,
  ClipStatus,
  IsoDateString,
  RecordingKind,
  UploadTicket,
} from "./shared"

/**
 * An owner-only recording synced to the server but NOT published as a clip.
 * Its id lives in its own namespace — it is never resolvable as a clip and
 * never appears in any feed, profile, or search. Only the owner can read it,
 * from their own library. A game is optional (best-effort from desktop
 * detection); publishing promotes the staging recording into a clip in place,
 * reusing the same stored media.
 *
 * Shape deliberately mirrors {@link ClipRow} (minus engagement counts and
 * privacy, plus `kind`) so the library editor and cards can treat a staging
 * recording and a published clip uniformly.
 */
export interface StagingRecordingRow {
  id: string
  authorId: string
  /** clip = short replay/highlight, session = long full-length capture. */
  kind: RecordingKind
  title: string
  description: string | null
  /** Display snapshot of the game name; null until one is known/resolved. */
  game: string | null
  /** Null when no game has been resolved yet (the whole point of staging). */
  steamgriddbId: number | null
  sourceContentType: string | null
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  sourceSizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  /** "thumbnail" when a poster exists, else null (mirrors ClipRow). */
  thumbKey: string | null
  thumbBlurHash: string | null
  status: ClipStatus
  encodeProgress: number
  failureReason: string | null
  /** Bare, lowercase-canonical hashtags; carried onto the clip on publish. */
  tags: string[]
  gameRef: ClipGameRef | null
  /** Name of the desktop device that uploaded it; null for web uploads. */
  originDeviceName: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

export interface StagingRecordingPage {
  items: StagingRecordingRow[]
  nextCursor: string | null
}

export interface InitiateStagingInput {
  filename: string
  contentType: AcceptedContentType
  sizeBytes: number
  /** Defaults to "clip" when omitted. */
  kind?: RecordingKind
  title: string
  description?: string
  /**
   * Both game fields are optional for staging. When a name is provided the
   * server resolves it best-effort (like game sessions) and stores whatever
   * it finds; an unresolved name is kept as the display snapshot with a null
   * steamgriddbId rather than rejected.
   */
  steamgriddbId?: number
  gameName?: string
  /** Bare hashtags; normalized server-side. */
  tags?: string[]
  /** Client-computed BlurHash of the poster frame. */
  thumbBlurHash?: string
  /** Poster format the client will upload; defaults to webp. */
  thumbContentType?: AcceptedThumbContentType
  /** Registered device the upload originates from (desktop sync engine). */
  originDeviceId?: string
  /** Play session the recording was captured in (desktop sync engine). */
  gameSessionId?: string
}

export interface InitiateStagingResponse {
  stagingId: string
  ticket: UploadTicket
  thumbTicket: UploadTicket
}

export interface UpdateStagingInput {
  kind?: RecordingKind
  title?: string
  description?: string
  /** Set a resolved game. Use `clearGame` to drop it back to null. */
  steamgriddbId?: number
  /** A raw detected name to resolve best-effort (sync path). */
  gameName?: string
  /** Explicitly clear any resolved game (returns to game-less staging). */
  clearGame?: boolean
  tags?: string[]
}

/**
 * Promote a staging recording into a published clip, reusing its stored media
 * in place (no re-upload). A resolved game IS required at this point — supply
 * either a steamgriddbId or a gameName the server can resolve.
 */
export interface PublishStagingInput {
  steamgriddbId?: number
  gameName?: string
  privacy?: ClipPrivacy
  /** Optional final overrides; otherwise the staging values carry over. */
  title?: string
  description?: string
  tags?: string[]
  mentionedUserIds?: string[]
}

export interface PublishStagingResponse {
  /** The id of the newly published clip (distinct from the staging id). */
  clipId: string
}
