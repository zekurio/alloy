import type {
  ProfileGameRow,
  ProfileMediaParams,
  PublicUser,
  UserClip,
  UserProfile,
  UserProfileViewer,
  UserSearchResult,
  UserStorageUsage,
} from "@alloy/contracts"

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
} from "@alloy/contracts"
export { USER_ASSET_PATH_PREFIX, userAssetImagePath } from "@alloy/contracts"

function usernameParam(handle: string) {
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
  const endpoint =
    kind === "avatar"
      ? context.rpc.api.users.me.avatar.upload
      : context.rpc.api.users.me.banner.upload
  const res = await endpoint.$post({ form: { file } })
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
    query: queryParams({ ...params }),
  })
  return readJsonOrThrow(res, validateProfileGameRows)
}

async function getTaggedClips(
  context: ApiContext,
  handle: string,
): Promise<UserClip[]> {
  const res = await context.rpc.api.users[":username"].tagged.$get({
    param: usernameParam(handle),
  })
  return readJsonOrThrow(res, validateClipRows)
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

async function setUserBlocked(
  context: ApiContext,
  handle: string,
  blocked: boolean,
): Promise<void> {
  const endpoint = context.rpc.api.users[":username"].block
  const params = {
    param: usernameParam(handle),
  }
  await readPostDeleteJson(
    blocked,
    {
      post: () => endpoint.$post(params),
      delete: () => endpoint.$delete(params),
    },
    booleanFlagResponseValidator("blocked", blocked),
  )
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
    async fetchMedia(
      handle: string,
      params: ProfileMediaParams = {},
    ): Promise<UserClip[]> {
      const res = await context.rpc.api.users[":username"].media.$get({
        param: usernameParam(handle),
        query: queryParams({ ...params }),
      })
      return readJsonOrThrow(res, validateClipRows)
    },
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
    search: (q: string, limit = 8) => searchUsers(context, q, limit),
    block: (handle: string) => setUserBlocked(context, handle, true),
    unblock: (handle: string) => setUserBlocked(context, handle, false),
    fetchAccountState: () => getAccountState(context),
    fetchStorageUsage: () => getStorageUsage(context),
    disableAccount: () => disableAccount(context),
    reactivateAccount: () => reactivateAccount(context),
    downloadAllClipsUrl: () => downloadAllClipsUrl(context),
    deleteAllClips: () => deleteAllClips(context),
  }
}
