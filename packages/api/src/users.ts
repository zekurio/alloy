import type { ApiContext } from "./client"
import {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  type AcceptedImageContentType,
  type PublicUser,
  type UserClip,
  type UserProfile,
  type UserProfileViewer,
  type UserSearchResult,
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
  const data = await blobToBase64(blob)
  const contentType = getUploadContentType(blob)
  const json: { data: string; contentType: AcceptedImageContentType } = {
    data,
    contentType,
  }
  const res = await context.request("/api/users/me/avatar/upload", {
    method: "POST",
    json,
  })
  return readJsonOrThrow<PublicUser>(res)
}

async function uploadBannerImage(
  context: ApiContext,
  blob: Blob
): Promise<PublicUser> {
  const data = await blobToBase64(blob)
  const contentType = getUploadContentType(blob)
  const json: { data: string; contentType: AcceptedImageContentType } = {
    data,
    contentType,
  }
  const res = await context.request("/api/users/me/banner/upload", {
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
  handle: string
): Promise<UserProfileViewer> {
  const res = await context.request(
    `/api/users/${encodeURIComponent(handle)}/viewer`
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

export function createUsersApi(context: ApiContext) {
  return {
    async uploadAvatar(blob: Blob): Promise<PublicUser> {
      return uploadAvatarImage(context, blob)
    },

    async uploadBanner(blob: Blob): Promise<PublicUser> {
      return uploadBannerImage(context, blob)
    },

    async removeAvatar(): Promise<PublicUser> {
      return deleteAvatar(context)
    },

    async removeBanner(): Promise<PublicUser> {
      return deleteBanner(context)
    },

    async fetchProfile(handle: string): Promise<UserProfile> {
      return getProfile(context, handle)
    },

    async fetchProfileViewer(handle: string): Promise<UserProfileViewer> {
      return getProfileViewer(context, handle)
    },

    async fetchClips(handle: string, init?: RequestInit): Promise<UserClip[]> {
      return getClips(context, handle, init)
    },

    async fetchTaggedClips(handle: string): Promise<UserClip[]> {
      return getTaggedClips(context, handle)
    },

    async search(q: string, limit = 8): Promise<UserSearchResult[]> {
      return searchUsers(context, q, limit)
    },

    async fetchFollowers(handle: string): Promise<UserSearchResult[]> {
      return getFollowers(context, handle)
    },

    async fetchFollowing(handle: string): Promise<UserSearchResult[]> {
      return getFollowing(context, handle)
    },

    async follow(handle: string): Promise<void> {
      await followUser(context, handle)
    },

    async unfollow(handle: string): Promise<void> {
      await unfollowUser(context, handle)
    },

    async block(handle: string): Promise<void> {
      await blockUser(context, handle)
    },

    async unblock(handle: string): Promise<void> {
      await unblockUser(context, handle)
    },

    async syncOAuthProfile(): Promise<void> {
      await requestOAuthProfileSync(context)
    },
  }
}
