import type { ApiContext } from "./client"
import {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  type AcceptedImageContentType,
  type PublicUser,
  type UserClip,
  type UserProfile,
  type UserSearchResult,
} from "@workspace/db/contracts"
import { readJsonOrThrow } from "./http"

export type {
  ProfileCounts,
  ProfileViewer,
  PublicUser,
  UserClip,
  UserProfile,
  UserSearchResult,
} from "@workspace/db/contracts"

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
  const res = await context.client.api.users.me.avatar.upload.$post({
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
  const res = await context.client.api.users.me.banner.upload.$post({
    json,
  })
  return readJsonOrThrow<PublicUser>(res)
}

async function deleteAvatar(context: ApiContext): Promise<PublicUser> {
  const res = await context.client.api.users.me.avatar.$delete()
  return readJsonOrThrow<PublicUser>(res)
}

async function deleteBanner(context: ApiContext): Promise<PublicUser> {
  const res = await context.client.api.users.me.banner.$delete()
  return readJsonOrThrow<PublicUser>(res)
}

async function getProfile(
  context: ApiContext,
  handle: string
): Promise<UserProfile> {
  const res = await context.client.api.users[":username"].$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserProfile>(res)
}

async function getClips(
  context: ApiContext,
  handle: string
): Promise<UserClip[]> {
  const res = await context.client.api.users[":username"].clips.$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserClip[]>(res)
}

async function getTaggedClips(
  context: ApiContext,
  handle: string
): Promise<UserClip[]> {
  const res = await context.client.api.users[":username"].tagged.$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserClip[]>(res)
}

async function searchUsers(
  context: ApiContext,
  q: string,
  limit = 8
): Promise<UserSearchResult[]> {
  const res = await context.client.api.users.search.$get({
    query: { q, limit: String(limit) },
  })
  return readJsonOrThrow<UserSearchResult[]>(res)
}

async function getFollowers(
  context: ApiContext,
  handle: string
): Promise<UserSearchResult[]> {
  const res = await context.client.api.users[":username"].followers.$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserSearchResult[]>(res)
}

async function getFollowing(
  context: ApiContext,
  handle: string
): Promise<UserSearchResult[]> {
  const res = await context.client.api.users[":username"].following.$get({
    param: { username: handle },
  })
  return readJsonOrThrow<UserSearchResult[]>(res)
}

async function followUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.client.api.users[":username"].follow.$post({
    param: { username: handle },
  })
  await readJsonOrThrow<{ following: true }>(res)
}

async function unfollowUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.client.api.users[":username"].follow.$delete({
    param: { username: handle },
  })
  await readJsonOrThrow<{ following: false }>(res)
}

async function blockUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.client.api.users[":username"].block.$post({
    param: { username: handle },
  })
  await readJsonOrThrow<{ blocked: true }>(res)
}

async function unblockUser(context: ApiContext, handle: string): Promise<void> {
  const res = await context.client.api.users[":username"].block.$delete({
    param: { username: handle },
  })
  await readJsonOrThrow<{ blocked: false }>(res)
}

async function requestOAuthProfileSync(context: ApiContext): Promise<void> {
  const res = await context.client.api.users.me["sync-oauth-profile"].$post()
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

    async fetchClips(handle: string): Promise<UserClip[]> {
      return getClips(context, handle)
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
