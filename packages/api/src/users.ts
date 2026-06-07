import type {
  ProfileGameRow,
  PublicUser,
  UserClip,
  UserProfile,
  UserProfileViewer,
  UserSearchResult,
  UserStorageUsage,
} from "alloy-contracts"

import type { ApiContext } from "./client"
import {
  booleanFlagResponseValidator,
  validateAccountStateResponse,
  validateClipRows,
  validateDeleteClipsResponse,
  validateDisableAccountResponse,
  validateProfileGameRows,
  validatePublicUser,
  validateReactivateAccountResponse,
  validateUserProfile,
  validateUserProfileViewer,
  validateUserStorageUsage,
  validateUserSummaries,
} from "./contract-validators"
import { readJsonOrThrow } from "./http"
import { readPostDeleteJson } from "./mutations"
import { encodedPathSegment, queryParams, resolvePublicUrl } from "./paths"

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
} from "alloy-contracts"
export {
  LEGACY_USER_ASSET_PATH_PREFIX,
  USER_ASSET_PATH_PREFIX,
  userAssetImagePath,
} from "alloy-contracts"

function usernameParam(handle: string): { username: string } {
  return { username: encodedPathSegment(handle) }
}

async function uploadAvatarImage(
  context: ApiContext,
  blob: Blob,
): Promise<PublicUser> {
  return uploadUserImage(context, blob, "avatar")
}

async function uploadBannerImage(
  context: ApiContext,
  blob: Blob,
): Promise<PublicUser> {
  return uploadUserImage(context, blob, "banner")
}

async function uploadUserImage(
  context: ApiContext,
  blob: Blob,
  kind: "avatar" | "banner",
): Promise<PublicUser> {
  const file =
    blob instanceof File ? blob : new File([blob], kind, { type: blob.type })
  const res =
    kind === "avatar"
      ? await context.rpc.api.users.me.avatar.upload.$post({ form: { file } })
      : await context.rpc.api.users.me.banner.upload.$post({ form: { file } })
  return readJsonOrThrow(res, validatePublicUser)
}

async function deleteAvatar(context: ApiContext): Promise<PublicUser> {
  const res = await context.rpc.api.users.me.avatar.$delete()
  return readJsonOrThrow(res, validatePublicUser)
}

async function deleteBanner(context: ApiContext): Promise<PublicUser> {
  const res = await context.rpc.api.users.me.banner.$delete()
  return readJsonOrThrow(res, validatePublicUser)
}

async function getProfile(
  context: ApiContext,
  handle: string,
): Promise<UserProfile> {
  const res = await context.rpc.api.users[":username"].$get({
    param: usernameParam(handle),
  })
  return readJsonOrThrow(res, validateUserProfile)
}

async function getProfileViewer(
  context: ApiContext,
  handle: string,
  init?: RequestInit,
): Promise<UserProfileViewer> {
  const res = await context.rpc.api.users[":username"].viewer.$get(
    { param: usernameParam(handle) },
    { init },
  )
  return readJsonOrThrow(res, validateUserProfileViewer)
}

async function getClips(
  context: ApiContext,
  handle: string,
  init?: RequestInit,
): Promise<UserClip[]> {
  const res = await context.rpc.api.users[":username"].clips.$get(
    { param: usernameParam(handle) },
    { init },
  )
  return readJsonOrThrow(res, validateClipRows)
}

async function getProfileGames(
  context: ApiContext,
  handle: string,
  params: { limit?: number; offset?: number } = {},
): Promise<ProfileGameRow[]> {
  const res = await context.rpc.api.users[":username"].games.$get({
    param: usernameParam(handle),
    query: queryParams(params),
  })
  return readJsonOrThrow(res, validateProfileGameRows)
}

async function getTaggedClips(
  context: ApiContext,
  handle: string,
): Promise<UserClip[]> {
  return getUserClipsArray(context, handle, "tagged")
}

async function getLikedClips(
  context: ApiContext,
  handle: string,
): Promise<UserClip[]> {
  return getUserClipsArray(context, handle, "liked")
}

async function searchUsers(
  context: ApiContext,
  q: string,
  limit = 8,
): Promise<UserSearchResult[]> {
  const res = await context.rpc.api.users.search.$get({
    query: { q, limit: String(limit) },
  })
  return readJsonOrThrow(res, validateUserSummaries)
}

async function getFollowers(
  context: ApiContext,
  handle: string,
): Promise<UserSearchResult[]> {
  return getUserConnections(context, handle, "followers")
}

async function getFollowing(
  context: ApiContext,
  handle: string,
): Promise<UserSearchResult[]> {
  return getUserConnections(context, handle, "following")
}

async function getUserConnections(
  context: ApiContext,
  handle: string,
  pathSegment: "followers" | "following",
): Promise<UserSearchResult[]> {
  const endpoint = context.rpc.api.users[":username"][pathSegment]
  const res = await endpoint.$get({ param: usernameParam(handle) })
  return readJsonOrThrow(res, validateUserSummaries)
}

async function getUserClipsArray(
  context: ApiContext,
  handle: string,
  pathSegment: "tagged" | "liked",
): Promise<UserClip[]> {
  const endpoint = context.rpc.api.users[":username"][pathSegment]
  const res = await endpoint.$get({ param: usernameParam(handle) })
  return readJsonOrThrow(res, validateClipRows)
}

async function setUserFlag(input: {
  context: ApiContext
  handle: string
  endpoint: "follow" | "block"
  key: "following" | "blocked"
  next: boolean
}): Promise<void> {
  const endpoint = input.context.rpc.api.users[":username"][input.endpoint]
  const params = {
    param: usernameParam(input.handle),
  }
  await readPostDeleteJson(
    input.next,
    {
      post: () => endpoint.$post(params),
      delete: () => endpoint.$delete(params),
    },
    booleanFlagResponseValidator(input.key, input.next),
  )
}

async function followUser(context: ApiContext, handle: string): Promise<void> {
  await setUserFlag({
    context,
    handle,
    endpoint: "follow",
    key: "following",
    next: true,
  })
}

async function unfollowUser(
  context: ApiContext,
  handle: string,
): Promise<void> {
  await setUserFlag({
    context,
    handle,
    endpoint: "follow",
    key: "following",
    next: false,
  })
}

async function blockUser(context: ApiContext, handle: string): Promise<void> {
  await setUserFlag({
    context,
    handle,
    endpoint: "block",
    key: "blocked",
    next: true,
  })
}

async function unblockUser(context: ApiContext, handle: string): Promise<void> {
  await setUserFlag({
    context,
    handle,
    endpoint: "block",
    key: "blocked",
    next: false,
  })
}

async function getAccountState(
  context: ApiContext,
): Promise<{ disabledAt: string | null }> {
  const res = await context.rpc.api.users.me.account.$get()
  return readJsonOrThrow(res, validateAccountStateResponse)
}

async function getStorageUsage(context: ApiContext): Promise<UserStorageUsage> {
  const res = await context.rpc.api.users.me.storage.$get()
  return readJsonOrThrow(res, validateUserStorageUsage)
}

async function disableAccount(
  context: ApiContext,
): Promise<{ disabledAt: string }> {
  const res = await context.rpc.api.users.me.disable.$post()
  return readJsonOrThrow(res, validateDisableAccountResponse)
}

async function reactivateAccount(
  context: ApiContext,
): Promise<{ disabledAt: null }> {
  const res = await context.rpc.api.users.me.reactivate.$post()
  return readJsonOrThrow(res, validateReactivateAccountResponse)
}

function downloadAllClipsUrl(context: ApiContext): string {
  return resolvePublicUrl("/api/users/me/clips/download", context.publicURL)
}

async function deleteAllClips(
  context: ApiContext,
): Promise<{ deleted: number; hasMore: boolean }> {
  const res = await context.rpc.api.users.me.clips.$delete({ query: {} })
  return readJsonOrThrow(res, validateDeleteClipsResponse)
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
      params: { limit?: number; offset?: number } = {},
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
    fetchAccountState: () => getAccountState(context),
    fetchStorageUsage: () => getStorageUsage(context),
    disableAccount: () => disableAccount(context),
    reactivateAccount: () => reactivateAccount(context),
    downloadAllClipsUrl: () => downloadAllClipsUrl(context),
    deleteAllClips: () => deleteAllClips(context),
  }
}
