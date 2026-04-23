import type { User } from "../auth-schema"
import type {
  Clip,
  ClipComment,
  ClipPrivacy,
  Game,
} from "../schema"

import type {
  AcceptedContentType,
  SerializeDates,
  UploadTicket,
} from "./shared"

export type ClipGameRef = SerializeDates<
  Pick<
    Game,
    "id" | "steamgriddbId" | "slug" | "name" | "releaseDate" | "heroUrl" | "gridUrl" | "logoUrl" | "iconUrl"
  >
>

export type ClipMentionRef = Pick<
  User,
  "id" | "username" | "displayUsername" | "name" | "image"
>

export type ClipRow = SerializeDates<
  Pick<
    Clip,
    | "id"
    | "slug"
    | "authorId"
    | "title"
    | "description"
    | "game"
    | "gameId"
    | "privacy"
    | "storageKey"
    | "contentType"
    | "sizeBytes"
    | "durationMs"
    | "width"
    | "height"
    | "trimStartMs"
    | "trimEndMs"
    | "variants"
    | "thumbKey"
    | "viewCount"
    | "likeCount"
    | "commentCount"
    | "status"
    | "encodeProgress"
    | "failureReason"
    | "createdAt"
    | "updatedAt"
  >
> & {
  authorUsername: User["username"]
  authorName: User["name"]
  authorImage: User["image"]
  gameRef: ClipGameRef | null
  mentions?: ClipMentionRef[]
}

export type ClipFeedWindow = "today" | "week" | "month" | "year" | "all"
export type ClipFeedSort = "top" | "recent"

export interface ClipFeedParams {
  window?: ClipFeedWindow
  sort?: ClipFeedSort
  limit?: number
  cursor?: string
}

export interface InitiateClipInput {
  filename: string
  contentType: AcceptedContentType
  sizeBytes: number
  title: string
  description?: string
  gameId: string
  privacy?: ClipPrivacy
  trimStartMs?: number
  trimEndMs?: number
  thumbSizeBytes: number
  mentionedUserIds?: string[]
}

export interface InitiateClipResponse {
  clipId: string
  slug: string
  ticket: UploadTicket
  thumbTicket: UploadTicket
}

export interface UpdateClipInput {
  title?: string
  description?: string
  gameId?: string
  privacy?: ClipPrivacy
  mentionedUserIds?: string[]
}

export interface ClipLikeState {
  liked: boolean
  likeCount: number
}

export type QueueClip = SerializeDates<
  Pick<
    Clip,
    "id" | "title" | "status" | "encodeProgress" | "failureReason" | "createdAt"
  >
> & {
  gameSlug: Game["slug"]
}

export type QueueEvent =
  | { type: "upsert"; clip: QueueClip }
  | { type: "progress"; id: string; encodeProgress: number }
  | { type: "remove"; id: string }

export type CommentAuthor = Pick<
  User,
  "id" | "username" | "displayUsername" | "name" | "image"
>

export type CommentRow = SerializeDates<
  Pick<
    ClipComment,
    | "id"
    | "clipId"
    | "parentId"
    | "body"
    | "likeCount"
    | "pinnedAt"
    | "createdAt"
    | "editedAt"
  >
> & {
  pinned: boolean
  likedByViewer: boolean
  likedByAuthor: boolean
  author: CommentAuthor
  replies: CommentRow[]
}

export type CommentSort = "top" | "new"

export type FeedFilter =
  | { kind: "foryou" }
  | { kind: "following" }
  | { kind: "game"; gameId: string }

export interface FeedPageParams {
  filter: FeedFilter
  limit?: number
  offset?: number
}

export interface FeedChipGame {
  id: string
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

export type GameRow = SerializeDates<
  Pick<
    Game,
    "id" | "steamgriddbId" | "name" | "slug" | "releaseDate" | "heroUrl" | "gridUrl" | "logoUrl" | "iconUrl"
  >
>

export interface GameListRow extends GameRow {
  clipCount: number
}

export interface GameDetail extends GameRow {
  viewer: { isFollowing: boolean } | null
}


export interface GameClipsParams {
  sort?: "top" | "recent"
  limit?: number
  cursor?: string
}

export interface SteamGridDBStatus {
  steamgriddbConfigured: boolean
}

export type PublicUser = SerializeDates<
  Pick<User, "id" | "username" | "name" | "image" | "banner" | "createdAt" | "updatedAt">
>

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
  viewer: ProfileViewer | null
}

export type UserClip = ClipRow

export type UserSearchResult = Pick<
  User,
  "id" | "username" | "displayUsername" | "name" | "image"
>

export type UserListRow = UserSearchResult & {
  clipCount: number
  createdAt: string
}

export interface SearchResults {
  clips: ClipRow[]
  games: GameListRow[]
  users: UserListRow[]
}
