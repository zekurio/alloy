import type { ApiContext } from "./client"
import {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  type AcceptedImageContentType,
  type PublicUser,
  type UserClip,
  type UserProfile,
  type UserProfileViewer,
  type UserSearchResult,
  type UserStorageUsage,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

export type {
  ProfileCounts,
  ProfileViewer,
  PublicUser,
  UserClip,
  UserProfile,
  UserProfileViewer,
  UserSearchResult,
  UserStorageUsage,
} from "@workspace/contracts"

const ACCEPTED_IMAGE_CONTENT_TYPE_SET: ReadonlySet<string> = new Set(
  ACCEPTED_IMAGE_CONTENT_TYPES
)

function isAcceptedImageContentType(
  value: string
): value is AcceptedImageContentType {
  return ACCEPTED_IMAGE_CONTENT_TYPE_SET.has(value)
}

function getUploadContentType(blob: Blob): AcceptedImageContentType {
  if (isAcceptedImageContentType(blob.type)) return blob.type
  throw new Error("Unsupported image type")
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

async function uploadAvatarImage(
  context: ApiContext,
  blob: Blob
): Promise<PublicUser> {
  return uploadUserImage(context, blob, "avatar")
}

async function uploadBannerImage(
  context: ApiContext,
  blob: Blob
): Promise<PublicUser> {
  return uploadUserImage(context, blob, "banner")
}

async function uploadUserImage(
  context: ApiContext,
  blob: Blob,
  kind: "avatar" | "banner"
): Promise<PublicUser> {
  const data = await blobToBase64(blob)
  const contentType = getUploadContentType(blob)
  const json: { data: string; contentType: AcceptedImageContentType } = {
    data,
    contentType,
  }
  const res = await context.request(`/api/users/me/${kind}/upload`, {
    method: "POST",
    json,
  })
  return readJsonOrThrow<PublicUser>(res)
}

async function deleteAvatar(context: ApiContext): Promise<PublicUser> {
  const res = await context.request("/api/users/me/avatar", {
    method: "DELETE",
  })
  return readJsonOrThrow<PublicUser>(res)
}

async function deleteBanner(context: ApiContext): Promise<PublicUser> {
  const res = await context.request("/api/users/me/banner", {
    method: "DELETE",
  })
  return readJsonOrThrow<PublicUser>(res)
}

async function getProfile(
  context: ApiContext,
  handle: string
): Promise<UserProfile> {
  const res = await context.request(`/api/users/${encodeURIComponent(handle)}`)
  return readJsonOrThrow<UserProfile>(res)
}

async function getProfileViewer(
  context: ApiContext,
  handle: string,
  init?: RequestInit
): Promise<UserProfileViewer> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/viewer`,
    { init }
  )
  return readJsonOrThrow<UserProfileViewer>(res)
}

async function getClips(
  context: ApiContext,
  handle: string,
  init?: RequestInit
): Promise<UserClip[]> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/clips`,
    { init }
  )
  return readJsonOrThrow<UserClip[]>(res)
}

async function getTaggedClips(
  context: ApiContext,
  handle: string
): Promise<UserClip[]> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/tagged`
  )
  return readJsonOrThrow<UserClip[]>(res)
}

async function getLikedClips(
  context: ApiContext,
  handle: string
): Promise<UserClip[]> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/liked`
  )
  return readJsonOrThrow<UserClip[]>(res)
}

async function searchUsers(
  context: ApiContext,
  q: string,
  limit = 8
): Promise<UserSearchResult[]> {
  const res = await context.request("/api/users/search", {
    query: { q, limit: String(limit) },
  })
  return readJsonOrThrow<UserSearchResult[]>(res)
}

async function getFollowers(
  context: ApiContext,
  handle: string
): Promise<UserSearchResult[]> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/followers`
  )
  return readJsonOrThrow<UserSearchResult[]>(res)
}

async function getFollowing(
  context: ApiContext,
  handle: string
): Promise<UserSearchResult[]> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/following`
  )
  return readJsonOrThrow<UserSearchResult[]>(res)
}

async function followUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/follow`,
    { method: "POST" }
  )
  await readJsonOrThrow<{ following: true }>(res)
}

async function unfollowUser(
  context: ApiContext,
  handle: string
): Promise<void> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/follow`,
    { method: "DELETE" }
  )
  await readJsonOrThrow<{ following: false }>(res)
}

async function blockUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/block`,
    { method: "POST" }
  )
  await readJsonOrThrow<{ blocked: true }>(res)
}

async function unblockUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/block`,
    { method: "DELETE" }
  )
  await readJsonOrThrow<{ blocked: false }>(res)
}

async function requestOAuthProfileSync(context: ApiContext): Promise<void> {
  const res = await context.request("/api/users/me/sync-oauth-profile", {
    method: "POST",
  })
  await readJsonOrThrow<{ synced: true }>(res)
}

async function getAccountState(
  context: ApiContext
): Promise<{ disabledAt: string | null }> {
  const res = await context.request("/api/users/me/account")
  return readJsonOrThrow<{ disabledAt: string | null }>(res)
}

async function getStorageUsage(context: ApiContext): Promise<UserStorageUsage> {
  const res = await context.request("/api/users/me/storage")
  return readJsonOrThrow<UserStorageUsage>(res)
}

async function disableAccount(
  context: ApiContext
): Promise<{ disabledAt: string }> {
  const res = await context.request("/api/users/me/disable", {
    method: "POST",
  })
  return readJsonOrThrow<{ disabledAt: string }>(res)
}

async function reactivateAccount(
  context: ApiContext
): Promise<{ disabledAt: null }> {
  const res = await context.request("/api/users/me/reactivate", {
    method: "POST",
  })
  return readJsonOrThrow<{ disabledAt: null }>(res)
}

function downloadAllClipsUrl(context: ApiContext): string {
  return new URL("/api/users/me/clips/download", context.baseURL).toString()
}

async function deleteAllClips(
  context: ApiContext
): Promise<{ deleted: number; hasMore: boolean }> {
  const res = await context.request("/api/users/me/clips", {
    method: "DELETE",
  })
  return readJsonOrThrow<{ deleted: number; hasMore: boolean }>(res)
}

export function createUsersApi(context: ApiContext) {
  return {
    uploadAvatar: (blob: Blob) => uploadAvatarImage(context, blob),
    uploadBanner: (blob: Blob) => uploadBannerImage(context, blob),
    removeAvatar: () => deleteAvatar(context),
    removeBanner: () => deleteBanner(context),
    fetchProfile: (handle: string) => getProfile(context, handle),
    fetchProfileViewer: (handle: string, init?: RequestInit) =>
      getProfileViewer(context, handle, init),
    fetchClips: (handle: string, init?: RequestInit) =>
      getClips(context, handle, init),
    fetchTaggedClips: (handle: string) => getTaggedClips(context, handle),
    fetchLikedClips: (handle: string) => getLikedClips(context, handle),
    search: (q: string, limit = 8) => searchUsers(context, q, limit),
    fetchFollowers: (handle: string) => getFollowers(context, handle),
    fetchFollowing: (handle: string) => getFollowing(context, handle),
    follow: (handle: string) => followUser(context, handle),
    unfollow: (handle: string) => unfollowUser(context, handle),
    block: (handle: string) => blockUser(context, handle),
    unblock: (handle: string) => unblockUser(context, handle),
    syncOAuthProfile: () => requestOAuthProfileSync(context),
    fetchAccountState: () => getAccountState(context),
    fetchStorageUsage: () => getStorageUsage(context),
    disableAccount: () => disableAccount(context),
    reactivateAccount: () => reactivateAccount(context),
    downloadAllClipsUrl: () => downloadAllClipsUrl(context),
    deleteAllClips: () => deleteAllClips(context),
  }
}
