import { api } from "./api"
import type { ClipRow } from "./clips-api"
import { readJsonOrThrow } from "./http-error"

export interface PublicUser {
  id: string
  /** URL-safe handle (lowercase) — used in URLs and mentions. */
  username: string
  /** Free-form display name. Empty string when not set. */
  name: string
  image: string | null
  /** ISO-8601 string — parse with `new Date(user.createdAt)` when needed. */
  createdAt: string
  /** ISO-8601 string. */
  updatedAt: string
}

export interface ProfileCounts {
  clips: number
  followers: number
  following: number
}

export interface ProfileViewer {
  isSelf: boolean
  isFollowing: boolean
  /** The viewer has blocked this user. */
  isBlocked: boolean
  /** This user has blocked the viewer (hide follow + messaging affordances). */
  isBlockedBy: boolean
}

export interface UserProfile {
  user: PublicUser
  counts: ProfileCounts
  viewer: ProfileViewer | null
}

export type UserClip = ClipRow

export async function fetchUserProfile(handle: string): Promise<UserProfile> {
  const res = await api.api.users[":username"].$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserProfile>(res)
}

export async function fetchUserClips(handle: string): Promise<UserClip[]> {
  const res = await api.api.users[":username"].clips.$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserClip[]>(res)
}

export async function fetchTaggedClips(handle: string): Promise<UserClip[]> {
  const res = await api.api.users[":username"].tagged.$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserClip[]>(res)
}

export interface UserSearchResult {
  id: string
  username: string
  displayUsername: string
  name: string
  image: string | null
}

export async function searchUsers(
  q: string,
  limit = 8
): Promise<UserSearchResult[]> {
  const res = await api.api.users.search.$get({
    query: { q, limit: String(limit) },
  })
  return readJsonOrThrow<UserSearchResult[]>(res)
}

export async function fetchUserFollowers(
  handle: string
): Promise<UserSearchResult[]> {
  const res = await api.api.users[":username"].followers.$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserSearchResult[]>(res)
}

export async function fetchUserFollowing(
  handle: string
): Promise<UserSearchResult[]> {
  const res = await api.api.users[":username"].following.$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserSearchResult[]>(res)
}

export async function followUser(handle: string): Promise<void> {
  const res = await api.api.users[":username"].follow.$post({
    param: { username: handle },
  })
  await readJsonOrThrow<{ following: true }>(res)
}

export async function unfollowUser(handle: string): Promise<void> {
  const res = await api.api.users[":username"].follow.$delete({
    param: { username: handle },
  })
  await readJsonOrThrow<{ following: false }>(res)
}

export async function blockUser(handle: string): Promise<void> {
  const res = await api.api.users[":username"].block.$post({
    param: { username: handle },
  })
  await readJsonOrThrow<{ blocked: true }>(res)
}

export async function unblockUser(handle: string): Promise<void> {
  const res = await api.api.users[":username"].block.$delete({
    param: { username: handle },
  })
  await readJsonOrThrow<{ blocked: false }>(res)
}
