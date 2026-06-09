import type {
  AcceptedContentType,
  ClipPrivacy,
  ClipStatus,
  IsoDateString,
  NotificationType,
  UploadTicket,
} from "./shared"

export interface PublicUser {
  id: string
  username: string
  name: string
  image: string | null
  banner: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

export interface UserSummary {
  id: string
  username: string
  displayUsername: string
  name: string
  image: string | null
}

export const USER_ASSET_PATH_PREFIX = "/api/assets/users/"
export const LEGACY_USER_ASSET_PATH_PREFIX = "/storage/user-assets/"

export function userAssetImagePath(key: string, updatedAt: Date): string {
  const version = updatedAt.getTime().toString(36)
  return `${USER_ASSET_PATH_PREFIX}${key}?v=${version}`
}

export interface ClipGameRef {
  id: number
  steamgriddbId: number
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

export interface ClipPlaybackQuality {
  id: string
  label: string
  bitrate: number
  videoBitrate: number
  audioBitrate: number
  width: number | null
  height: number
}

export interface ClipRow {
  id: string
  authorId: string
  title: string
  description: string | null
  game: string | null
  steamgriddbId: number
  privacy: ClipPrivacy
  sourceContentType: string | null
  sourceVideoCodec: string | null
  sourceAudioCodec: string | null
  sourceSizeBytes: number | null
  openGraphContentType: string | null
  openGraphSizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  playbackQualities: ClipPlaybackQuality[]
  thumbKey: string | null
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
  authorName: string
  authorImage: string | null
  gameRef: ClipGameRef | null
  mentions?: ClipMentionRef[]
}

export type ClipFeedWindow = "today" | "week" | "month" | "year" | "all"
export type ClipFeedSort = "top" | "recent"

export const CLIP_TITLE_MAX_LENGTH = 100
export const CLIP_DESCRIPTION_MAX_LENGTH = 2000

export interface ClipFeedParams {
  window?: ClipFeedWindow
  sort?: ClipFeedSort
  limit?: number
  cursor?: string | null
  hashtag?: string
}

export interface ClipPage {
  items: ClipRow[]
  nextCursor: string | null
}

export interface InitiateClipInput {
  filename: string
  contentType: AcceptedContentType
  sizeBytes: number
  title: string
  description?: string
  steamgriddbId: number
  privacy?: ClipPrivacy
  mentionedUserIds?: string[]
}

export interface InitiateClipResponse {
  clipId: string
  ticket: UploadTicket
}

export interface UpdateClipInput {
  title?: string
  description?: string
  steamgriddbId?: number
  privacy?: ClipPrivacy
  mentionedUserIds?: string[]
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
  thumbBlurHash: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
  steamgriddbId: number
  gameSlug: string
}

export type QueueEvent =
  | { type: "upsert"; clip: QueueClip }
  | { type: "progress"; id: string; encodeProgress: number }
  | { type: "remove"; id: string }

export interface NotificationClipRef {
  id: string
  title: string
  gameSlug: string
  /** True when the clip has a generated thumbnail available for preview. */
  hasThumb: boolean
  thumbBlurHash: string | null
  updatedAt: IsoDateString
}

export interface NotificationCommentRef {
  id: string
  body: string
}

export interface NotificationRow {
  id: string
  type: NotificationType
  actor: UserSummary | null
  clip: NotificationClipRef | null
  comment: NotificationCommentRef | null
  readAt: IsoDateString | null
  createdAt: IsoDateString
}

export interface NotificationsResponse {
  items: NotificationRow[]
  unreadCount: number
}

export const NOTIFICATIONS_DEFAULT_LIMIT = 20
export const NOTIFICATIONS_MAX_LIMIT = 50

export type NotificationEvent =
  | { type: "snapshot"; payload: NotificationsResponse }
  | { type: "upsert"; notification: NotificationRow; unreadCount: number }
  | { type: "read"; id: string; readAt: IsoDateString; unreadCount: number }
  | { type: "read_all"; readAt: IsoDateString; unreadCount: number }
  | { type: "remove"; id: string; unreadCount: number }
  | { type: "clear"; unreadCount: number }

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
  | { kind: "foryou" }
  | { kind: "following" }
  | { kind: "game"; steamgriddbId: number }
  | { kind: "hashtag"; tag: string }

export interface FeedPageParams {
  filter: FeedFilter
  limit?: number
  cursor?: string | null
}

export interface FeedPage {
  items: ClipRow[]
  nextCursor: string | null
}

export interface FeedChipGame {
  id: number
  steamgriddbId: number
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

export interface SteamGridDBSearchResult {
  id: number
  name: string
  release_date?: number
  types?: string[]
  verified?: boolean
  iconUrl?: string | null
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
  id: number
  steamgriddbId: number
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
}

export interface GameClipsParams {
  sort?: "top" | "recent"
  limit?: number
  cursor?: string | null
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
