import type { ApiContext } from "./client"
import {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  type AcceptedImageContentType,
  type ProfileGameRow,
  type PublicUser,
  type UserClip,
  type UserProfile,
  type UserProfileViewer,
  type UserSearchResult,
  type UserStorageUsage,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"
import {
  validateBooleanFlag,
  validateObject,
  validateObjectArray,
} from "./contract-validators"

export type {
  ProfileCounts,
  ProfileGameRow,
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
  const res =
    kind === "avatar"
      ? await context.rpc.api.users.me.avatar.upload.$post({ json })
      : await context.rpc.api.users.me.banner.upload.$post({ json })
  return readJsonOrThrow(res, (value) =>
    validateObject<PublicUser>(value, "user")
  )
}

async function deleteAvatar(context: ApiContext): Promise<PublicUser> {
  const res = await context.rpc.api.users.me.avatar.$delete()
  return readJsonOrThrow(res, (value) =>
    validateObject<PublicUser>(value, "user")
  )
}

async function deleteBanner(context: ApiContext): Promise<PublicUser> {
  const res = await context.rpc.api.users.me.banner.$delete()
  return readJsonOrThrow(res, (value) =>
    validateObject<PublicUser>(value, "user")
  )
}

async function getProfile(
  context: ApiContext,
  handle: string
): Promise<UserProfile> {
  const res = await context.rpc.api.users[":username"].$get({
    param: { username: handle },
  })
  return readJsonOrThrow(res, (value) =>
    validateObject<UserProfile>(value, "user profile")
  )
}

async function getProfileViewer(
  context: ApiContext,
  handle: string,
  init?: RequestInit
): Promise<UserProfileViewer> {
  const res = await context.rpc.api.users[":username"].viewer.$get(
    { param: { username: handle } },
    { init }
  )
  return readJsonOrThrow(res, (value) =>
    validateObject<UserProfileViewer>(value, "profile viewer")
  )
}

async function getClips(
  context: ApiContext,
  handle: string,
  init?: RequestInit
): Promise<UserClip[]> {
  const res = await context.rpc.api.users[":username"].clips.$get(
    { param: { username: handle } },
    { init }
  )
  return readJsonOrThrow(res, (value) =>
    validateObjectArray<UserClip>(value, "user clips")
  )
}

async function getProfileGames(
  context: ApiContext,
  handle: string,
  params: { limit?: number; offset?: number } = {}
): Promise<ProfileGameRow[]> {
  const res = await context.rpc.api.users[":username"].games.$get({
    param: { username: handle },
    query: {
      ...(params.limit !== undefined ? { limit: String(params.limit) } : {}),
      ...(params.offset !== undefined ? { offset: String(params.offset) } : {}),
    },
  })
  return readJsonOrThrow(res, (value) =>
    validateObjectArray<ProfileGameRow>(value, "profile games")
  )
}

async function getTaggedClips(
  context: ApiContext,
  handle: string
): Promise<UserClip[]> {
  return getUserArray<UserClip>(context, handle, "tagged", "tagged clips")
}

async function getLikedClips(
  context: ApiContext,
  handle: string
): Promise<UserClip[]> {
  return getUserArray<UserClip>(context, handle, "liked", "liked clips")
}

async function searchUsers(
  context: ApiContext,
  q: string,
  limit = 8
): Promise<UserSearchResult[]> {
  const res = await context.rpc.api.users.search.$get({
    query: { q, limit: String(limit) },
  })
  return readJsonOrThrow(res, (value) =>
    validateObjectArray<UserSearchResult>(value, "user search")
  )
}

async function getFollowers(
  context: ApiContext,
  handle: string
): Promise<UserSearchResult[]> {
  return getUserConnections(context, handle, "followers")
}

async function getFollowing(
  context: ApiContext,
  handle: string
): Promise<UserSearchResult[]> {
  return getUserConnections(context, handle, "following")
}

async function getUserConnections(
  context: ApiContext,
  handle: string,
  pathSegment: "followers" | "following"
): Promise<UserSearchResult[]> {
  return getUserArray<UserSearchResult>(
    context,
    handle,
    pathSegment,
    pathSegment
  )
}

async function getUserArray<T>(
  context: ApiContext,
  handle: string,
  pathSegment: string,
  label: string
): Promise<T[]> {
  const endpoint =
    context.rpc.api.users[":username"][
      pathSegment as "tagged" | "liked" | "followers" | "following"
    ]
  const res = await endpoint.$get({ param: { username: handle } })
  return readJsonOrThrow(res, (value) => validateObjectArray<T>(value, label))
}

async function followUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.rpc.api.users[":username"].follow.$post({
    param: { username: handle },
  })
  validateBooleanFlag(await readJsonOrThrow<unknown>(res), "following", true)
}

async function unfollowUser(
  context: ApiContext,
  handle: string
): Promise<void> {
  const res = await context.rpc.api.users[":username"].follow.$delete({
    param: { username: handle },
  })
  validateBooleanFlag(await readJsonOrThrow<unknown>(res), "following", false)
}

async function blockUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.rpc.api.users[":username"].block.$post({
    param: { username: handle },
  })
  validateBooleanFlag(await readJsonOrThrow<unknown>(res), "blocked", true)
}

async function unblockUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.rpc.api.users[":username"].block.$delete({
    param: { username: handle },
  })
  validateBooleanFlag(await readJsonOrThrow<unknown>(res), "blocked", false)
}

async function requestOAuthProfileSync(context: ApiContext): Promise<void> {
  const res = await context.rpc.api.users.me["sync-oauth-profile"].$post()
  validateBooleanFlag(await readJsonOrThrow<unknown>(res), "synced")
}

async function getAccountState(
  context: ApiContext
): Promise<{ disabledAt: string | null }> {
  const res = await context.rpc.api.users.me.account.$get()
  return readJsonOrThrow(res, (value) =>
    validateObject<{ disabledAt: string | null }>(value, "account state")
  )
}

async function getStorageUsage(context: ApiContext): Promise<UserStorageUsage> {
  const res = await context.rpc.api.users.me.storage.$get()
  return readJsonOrThrow(res, (value) =>
    validateObject<UserStorageUsage>(value, "storage usage")
  )
}

async function disableAccount(
  context: ApiContext
): Promise<{ disabledAt: string }> {
  const res = await context.rpc.api.users.me.disable.$post()
  return readJsonOrThrow(res, (value) =>
    validateObject<{ disabledAt: string }>(value, "disable account")
  )
}

async function reactivateAccount(
  context: ApiContext
): Promise<{ disabledAt: null }> {
  const res = await context.rpc.api.users.me.reactivate.$post()
  return readJsonOrThrow(res, (value) =>
    validateObject<{ disabledAt: null }>(value, "reactivate account")
  )
}

function downloadAllClipsUrl(context: ApiContext): string {
  return new URL("/api/users/me/clips/download", context.publicURL).toString()
}

async function deleteAllClips(
  context: ApiContext
): Promise<{ deleted: number; hasMore: boolean }> {
  const res = await context.rpc.api.users.me.clips.$delete({ query: {} })
  return readJsonOrThrow(res, (value) =>
    validateObject<{ deleted: number; hasMore: boolean }>(value, "delete clips")
  )
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
    fetchProfileGames: (
      handle: string,
      params: { limit?: number; offset?: number } = {}
    ) => getProfileGames(context, handle, params),
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
