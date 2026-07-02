import type {
  AcceptedContentType,
  AcceptedThumbContentType,
  ClipPrivacy,
  ClipStatus,
  GameSource,
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
  displayUsername: string
  image: string | null
}

export const USER_ASSET_PATH_PREFIX = "/api/assets/users/"
export const LEGACY_USER_ASSET_PATH_PREFIX = "/storage/user-assets/"

export function userAssetImagePath(key: string, updatedAt: Date): string {
  const version = updatedAt.getTime().toString(36)
  return `${USER_ASSET_PATH_PREFIX}${key}?v=${version}`
}

export const GAME_ASSET_PATH_PREFIX = "/api/assets/games/"

export function gameAssetImagePath(key: string, updatedAt: Date): string {
  const version = updatedAt.getTime().toString(36)
  return `${GAME_ASSET_PATH_PREFIX}${key}?v=${version}`
}

export interface ClipGameRef {
  id: string
  steamgriddbId: number | null
  source: GameSource
  slug: string
  name: string
  releaseDate: IsoDateString | null
  heroUrl: string | null
  heroBlurHash: string | null
  gridUrl: string | null
  gridBlurHash: string | null
  logoUrl: string | null
  iconUrl: string | null
}

export type ClipMentionRef = UserSummary

/** One encoded quality tier of a clip, as exposed to clients. */
export interface ClipRenditionRef {
  /** Stable per-tier slug like "1080p" or "1080p60-hevc"; keys rendition URLs. */
  name: string
  height: number
  width: number
  fps: number
  /** RFC 6381 codec string, used only for display disambiguation. */
  codecs: string
  /** Cache-busting version of this tier's file bytes; changes on re-encode. */
  version: string
}

export interface ClipRow {
  id: string
  authorId: string
  title: string
  description: string | null
  game: string | null
  gameId: string | null
  privacy: ClipPrivacy
  sourceContentType: string | null
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  sourceSizeBytes: number | null
  /** Cache-busting version of the published source bytes; changes on republish. */
  sourceVersion: string | null
  /** Encoded quality tiers, highest first; empty until the pipeline commits. */
  renditions: ClipRenditionRef[]
  /** Cache-busting version of the HLS playlist set; null without renditions. */
  playbackVersion: string | null
  durationMs: number | null
  width: number | null
  height: number | null
  thumbKey: string | null
  thumbVersion: string | null
  thumbBlurHash: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  status: ClipStatus
  encodeProgress: number
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
   * Client-computed BlurHash of the clip's poster frame. The server validates
   * and publishes it only when the uploaded thumbnail image is accepted.
   */
  thumbBlurHash?: string
  /** Poster format the client will upload; defaults to JPEG. */
  thumbContentType?: AcceptedThumbContentType
}

export interface InitiateClipResponse {
  clipId: string
  ticket: UploadTicket
  /**
   * Upload target for the client-rendered poster image. The desktop
   * client uploads its thumbnail here so the server never has to extract a
   * frame. Best-effort: a clip without a published thumbnail still works.
   */
  thumbTicket: UploadTicket
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

export interface ClipLikeState {
  liked: boolean
  likeCount: number
}

export interface QueueClip {
  id: string
  title: string
  status: ClipStatus
  encodeProgress: number
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
  | { kind: "game"; gameId: string }

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

export interface FeedChipGame {
  id: string
  steamgriddbId: number | null
  slug: string
  name: string
  iconUrl: string | null
  logoUrl: string | null
  interaction: number
  clipCount: number
}

export interface FeedChipsResponse {
  games: FeedChipGame[]
}

export interface TagClipsParams {
  sort?: ClipListSort
  /** Narrow to a single game by surrogate id. */
  gameId?: string
  limit?: number
  cursor?: string | null
}

export interface TagGamesResponse {
  clipCount: number
  games: GameListRow[]
}

export interface SteamGridDBSearchResult {
  id: number
  name: string
  release_date?: number | null
  types?: string[]
  verified?: boolean
  heroUrl?: string | null
  gridUrl?: string | null
  iconUrl?: string | null
  logoUrl?: string | null
}

export interface SteamGridDBGameDetail {
  id: number
  name: string
  release_date?: number | null
  types?: string[]
  verified?: boolean
}

export interface SteamGridDBAsset {
  id: number
  url: string
  thumb?: string
  width?: number
  height?: number
  style?: string
  nsfw?: boolean
  humor?: boolean
}

export interface GameRow {
  id: string
  steamgriddbId: number | null
  source: GameSource
  name: string
  slug: string
  releaseDate: IsoDateString | null
  heroUrl: string | null
  heroBlurHash: string | null
  gridUrl: string | null
  gridBlurHash: string | null
  logoUrl: string | null
  iconUrl: string | null
}

export interface GameListRow extends GameRow {
  clipCount: number
}

export interface ProfileGameRow extends GameListRow {
  lastClippedAt: IsoDateString
}

export interface GameDetail extends GameRow {
  viewer: { isFollowing: boolean } | null
  favouritesCount: number
  /** Ready, public clips attributed to this game by enabled users. */
  clipCount: number
}

export const GAME_ASSET_ROLES = ["hero", "grid", "logo", "icon"] as const
export type GameAssetRole = (typeof GAME_ASSET_ROLES)[number]

export interface AdminGameRow extends GameRow {
  clipCount: number
}

export interface AdminCreateGameInput {
  name: string
  releaseDate?: string | null
  heroUrl?: string | null
  gridUrl?: string | null
  logoUrl?: string | null
  iconUrl?: string | null
}

export interface AdminUpdateGameInput {
  name?: string
  slug?: string
  releaseDate?: string | null
  heroUrl?: string | null
  gridUrl?: string | null
  logoUrl?: string | null
  iconUrl?: string | null
}

export type GameNameLookupReason =
  | "indexed-exact-name"
  | "indexed-normalized-name"
  | "steamgriddb-exact-name"
  | "steamgriddb-normalized-name"
  | "no-match"
  | "ambiguous"

export interface GameNameLookupResult {
  name: string
  game: GameRow | null
  confidence: number
  reason: GameNameLookupReason
}

export interface GameNameLookupResponse {
  results: GameNameLookupResult[]
}

export interface SteamGridDBStatus {
  steamgriddbConfigured: boolean
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
