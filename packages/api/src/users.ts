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
import { blobAsFile } from "./form-file"
import { readJsonOrThrow } from "./http"
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

export function createUsersApi(context: ApiContext) {
  const users = context.rpc.api.users

  async function uploadImage(
    blob: Blob,
    kind: "avatar" | "banner",
  ): Promise<PublicUser> {
    const res = await users.me[kind].upload.$post({
      form: { file: blobAsFile(blob, kind) },
    })
    return readJsonOrThrow(res, validatePublicUser)
  }

  return {
    async fetchMedia(
      handle: string,
      params: ProfileMediaParams = {},
    ): Promise<UserClip[]> {
      const res = await users[":username"].media.$get({
        param: usernameParam(handle),
        query: queryParams({ ...params }),
      })
      return readJsonOrThrow(res, validateClipRows)
    },
    uploadAvatar: (blob: Blob) => uploadImage(blob, "avatar"),
    uploadBanner: (blob: Blob) => uploadImage(blob, "banner"),
    async removeAvatar(): Promise<PublicUser> {
      const res = await users.me.avatar.$delete()
      return readJsonOrThrow(res, validatePublicUser)
    },
    async removeBanner(): Promise<PublicUser> {
      const res = await users.me.banner.$delete()
      return readJsonOrThrow(res, validatePublicUser)
    },
    async fetchProfile(handle: string): Promise<UserProfile> {
      const res = await users[":username"].$get({
        param: usernameParam(handle),
      })
      return readJsonOrThrow(res, validateUserProfile)
    },
    async fetchProfileViewer(handle: string): Promise<UserProfileViewer> {
      const res = await users[":username"].viewer.$get({
        param: usernameParam(handle),
      })
      return readJsonOrThrow(res, validateUserProfileViewer)
    },
    async fetchProfileGames(
      handle: string,
      params: { limit?: number; offset?: number } = {},
    ): Promise<ProfileGameRow[]> {
      const res = await users[":username"].games.$get({
        param: usernameParam(handle),
        query: queryParams({ ...params }),
      })
      return readJsonOrThrow(res, validateProfileGameRows)
    },
    async search(
      q: string,
      limit = 8,
      signal?: AbortSignal,
    ): Promise<UserSearchResult[]> {
      const res = await users.search.$get(
        { query: { q, limit: String(limit) } },
        { init: { signal } },
      )
      return readJsonOrThrow(res, validateUserSummaries)
    },
    async unblock(handle: string): Promise<void> {
      const res = await users[":username"].block.$delete({
        param: usernameParam(handle),
      })
      await readJsonOrThrow(res, booleanFlagResponseValidator("blocked", false))
    },
    async fetchStorageUsage(): Promise<UserStorageUsage> {
      const res = await users.me.storage.$get()
      return readJsonOrThrow(res, validateUserStorageUsage)
    },
    async disableAccount(): Promise<{ disabledAt: string }> {
      const res = await users.me.disable.$post()
      return readJsonOrThrow(res, validateDisableAccountResponse)
    },
    async reactivateAccount(): Promise<{ disabledAt: null }> {
      const res = await users.me.reactivate.$post()
      return readJsonOrThrow(res, validateReactivateAccountResponse)
    },
    downloadAllClipsUrl: () =>
      resolvePublicUrl("/api/users/me/clips/download", context.publicURL),
    async deleteAllClips(): Promise<{ deleted: number; hasMore: boolean }> {
      const res = await users.me.clips.$delete({ query: {} })
      return readJsonOrThrow(res, validateDeleteClipsResponse)
    },
  }
}
