import type { ClipGameRef, GameListRow } from "./content-games"
import type {
  AcceptedContentType,
  ClipPrivacy,
  ClipStatus,
  IsoDateString,
  UploadTicket,
} from "./shared"

export interface PublicUser {
  id: string
  username: string
  image: string | null
  banner: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

export interface UserSummary {
  id: string
  username: string
  image: string | null
}

export const USER_ASSET_PATH_PREFIX = "/api/assets/users/"
export const LEGACY_USER_ASSET_PATH_PREFIX = "/storage/user-assets/"

/** Query param appended to post-auth redirects to open the profile-setup prompt. */
export const WELCOME_QUERY_KEY = "welcome"

export function userAssetImagePath(key: string, updatedAt: Date): string {
  const version = updatedAt.getTime().toString(36)
  return `${USER_ASSET_PATH_PREFIX}${key}?v=${version}`
}

export {
  GAME_ASSET_PATH_PREFIX,
  GAME_ASSET_ROLES,
  gameAssetImagePath,
} from "./content-games"
export type {
  AdminCreateGameInput,
  AdminGameRow,
  AdminUpdateGameInput,
  ClipGameRef,
  FeedChipGame,
  FeedChipsResponse,
  GameAssetRole,
  GameDetail,
  GameListRow,
  GameNameLookupReason,
  GameNameLookupResponse,
  GameNameLookupResult,
  GameRow,
  ProfileGameRow,
  SteamGridDBAsset,
  SteamGridDBGameDetail,
  SteamGridDBSearchResult,
  SteamGridDBStatus,
  TagGamesResponse,
} from "./content-games"

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
  /** Encoded quality tiers, highest first; empty until the pipeline commits. */
  renditions: ClipRenditionRef[]
  durationMs: number | null
  width: number | null
  height: number | null
  thumbKey: string | null
  thumbVersion: string | null
  thumbBlurHash: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  trimStartMs: number | null
  trimEndMs: number | null
  status: ClipStatus
  encodeProgress: number
  encodeStage: EncodeStage | null
  encodeTier: string | null
  encodeTierIndex: number | null
  encodeTierCount: number | null
  failureReason: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
  authorUsername: string
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

/**
 * Trim-scrubber sprite sheet layout, shared between the server tile pass and
 * the client slicer: frame count cells tiled this many columns wide.
 */
export const CLIP_SCRUBBER_FRAME_COUNT = 16
export const CLIP_SCRUBBER_COLUMNS = 4

export interface ClipPage {
  items: ClipRow[]
  nextCursor: string | null
}

export interface InitiateClipInput {
  /**
   * Client-generated clip ID for optimistic local queue rows. The server still
   * validates uniqueness and may reject a collision.
   */
  clientClipId?: string
  filename: string
  contentType: AcceptedContentType
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

export interface ClipLikeState {
  liked: boolean
  likeCount: number
}

export interface QueueClip {
  id: string
  title: string
  status: ClipStatus
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

export type CommentAuthor = UserSummary

export const COMMENT_BODY_MAX_LENGTH = 2000
// Captures @mentions after start/whitespace/open punctuation and stops at
// whitespace, another @, or path separators. Usernames may contain unicode,
// dots, and dashes; trailing sentence punctuation is trimmed by the parser.
export const MENTION_PATTERN = /(?:^|[\s([{])@([^\s@/\\]{1,24})/gu

export function parseMentionUsernames(text: string): string[] {
  const trailingPunctuation = /[.,!?;:)\]}]+$/u
  const out = new Set<string>()
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const username = match[1].replace(trailingPunctuation, "").toLowerCase()
    if (username) out.add(username)
  }
  return [...out]
}

export interface CommentRow {
  id: string
  clipId: string
  parentId: string | null
  body: string
  likeCount: number
  pinnedAt: IsoDateString | null
  createdAt: IsoDateString
  editedAt: IsoDateString | null
  pinned: boolean
  likedByViewer: boolean
  likedByAuthor: boolean
  author: CommentAuthor
  mentions: string[]
  replies: CommentRow[]
}

export type CommentSort = "top" | "new"

export interface CommentPage {
  items: CommentRow[]
  nextCursor: string | null
}

export type FeedFilter =
  | { kind: "all" }
  | { kind: "following" }
  | { kind: "game"; gameId: string; authorId?: string }

export interface FeedPageParams {
  filter: FeedFilter
  sort: ClipFeedSort
  limit?: number
  cursor?: string | null
}

export interface FeedPage {
  items: ClipRow[]
  nextCursor: string | null
}

export interface GameCreator extends UserSummary {
  clipCount: number
}

export interface GameCreatorsResponse {
  creators: GameCreator[]
}

export interface TagClipsParams {
  sort?: ClipListSort
  /** Narrow to a single game by surrogate id. */
  gameId?: string
  limit?: number
  cursor?: string | null
}

export interface ProfileCounts {
  clips: number
  followers: number
  following: number
}

export interface ProfileViewer {
  isSelf: boolean
  isFollowing: boolean
  isBlocked: boolean
  isBlockedBy: boolean
}

export interface UserProfile {
  user: PublicUser
  counts: ProfileCounts
}

export interface UserProfileViewer {
  viewer: ProfileViewer | null
  counts: ProfileCounts | null
}

export type UserClip = ClipRow
export type UserSearchResult = UserSummary

export interface UserListRow extends UserSearchResult {
  clipCount: number
  createdAt: IsoDateString
}

export interface UserStorageUsage {
  usedBytes: number
  quotaBytes: number | null
}

export interface SearchResults {
  clips: ClipRow[]
  games: GameListRow[]
  users: UserListRow[]
}
