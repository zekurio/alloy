import type { ClipRow } from "./content-clips"
import type { IsoDateString } from "./shared"

export interface PublicUser {
  id: string
  username: string
  displayName: string | null
  image: string | null
  banner: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

export interface UserSummary {
  id: string
  username: string
  displayName: string | null
  image: string | null
}

/**
 * The one place that decides what to render for a user: their display name
 * when set, otherwise the handle. Never store the fallback — a user who later
 * renames should not be stuck showing a stale copy.
 */
export function userDisplayLabel(user: {
  username: string
  displayName?: string | null
}): string {
  return user.displayName?.trim() || user.username
}

export const USER_ASSET_PATH_PREFIX = "/api/assets/users/"

/** Query param appended to post-auth redirects to open the profile-setup prompt. */
export const WELCOME_QUERY_KEY = "welcome"

export function userAssetImagePath(key: string, updatedAt: Date): string {
  const version = updatedAt.getTime().toString(36)
  return `${USER_ASSET_PATH_PREFIX}${key}?v=${version}`
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
