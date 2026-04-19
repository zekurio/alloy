import { api } from "./api"
import type { ClipRow } from "./clips-api"

/**
 * Client-side wrappers for the /api/users/* endpoints. All functions throw
 * on non-2xx so callers can surface the error message in a toast — the
 * profile page and follow/block buttons rely on that contract.
 *
 * The response shapes mirror `apps/server/src/routes/users.ts`. If either
 * side changes, update both — the Hono RPC types will catch most mismatches
 * but we keep explicit interfaces here so consumers don't pull response
 * types through deeply generic RPC plumbing.
 *
 * Every function takes a `handle` string — either the user's username or a
 * raw user id. The server resolves both so older links (which used ids)
 * keep working.
 */

export interface PublicUser {
  id: string
  /** URL-safe handle — the single user-facing name. */
  username: string
  image: string | null
  /** ISO-8601 string — parse with `new Date(user.createdAt)` when needed. */
  createdAt: string
}

export interface ProfileCounts {
  clips: number
  followers: number
  following: number
}

/**
 * Viewer-relative state for a profile. Null when the request is made by a
 * signed-out visitor — callers should treat that as "no actions available"
 * rather than "default all to false".
 */
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

/**
 * Same shape as the home-feed `ClipRow` — the server joins the author on
 * both routes so the two surfaces can share a single mapper
 * (`toClipCardData`).
 */
export type UserClip = ClipRow

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export async function fetchUserProfile(handle: string): Promise<UserProfile> {
  const res = await api.api.users[":username"].$get({
    param: { username: handle },
  })
  return readJson<UserProfile>(res)
}

export async function fetchUserClips(handle: string): Promise<UserClip[]> {
  const res = await api.api.users[":username"].clips.$get({
    param: { username: handle },
  })
  return readJson<UserClip[]>(res)
}

export async function followUser(handle: string): Promise<void> {
  const res = await api.api.users[":username"].follow.$post({
    param: { username: handle },
  })
  await readJson<{ following: true }>(res)
}

export async function unfollowUser(handle: string): Promise<void> {
  const res = await api.api.users[":username"].follow.$delete({
    param: { username: handle },
  })
  await readJson<{ following: false }>(res)
}

export async function blockUser(handle: string): Promise<void> {
  const res = await api.api.users[":username"].block.$post({
    param: { username: handle },
  })
  await readJson<{ blocked: true }>(res)
}

export async function unblockUser(handle: string): Promise<void> {
  const res = await api.api.users[":username"].block.$delete({
    param: { username: handle },
  })
  await readJson<{ blocked: false }>(res)
}
