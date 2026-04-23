import type { ApiContext } from "./client"
import type { ClipRow } from "./clips"
import { readJsonOrThrow } from "./http"

export interface PublicUser {
  id: string
  username: string
  name: string
  image: string | null
  createdAt: string
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
  isBlocked: boolean
  isBlockedBy: boolean
}

export interface UserProfile {
  user: PublicUser
  counts: ProfileCounts
  viewer: ProfileViewer | null
}

export type UserClip = ClipRow

export interface UserSearchResult {
  id: string
  username: string
  displayUsername: string
  name: string
  image: string | null
}

export function createUsersApi(context: ApiContext) {
  return {
    async fetchProfile(handle: string): Promise<UserProfile> {
      const res = await context.client.api.users[":username"].$get({
        param: { username: handle },
      })
      return readJsonOrThrow<UserProfile>(res)
    },

    async fetchClips(handle: string): Promise<UserClip[]> {
      const res = await context.client.api.users[":username"].clips.$get({
        param: { username: handle },
      })
      return readJsonOrThrow<UserClip[]>(res)
    },

    async fetchTaggedClips(handle: string): Promise<UserClip[]> {
      const res = await context.client.api.users[":username"].tagged.$get({
        param: { username: handle },
      })
      return readJsonOrThrow<UserClip[]>(res)
    },

    async search(q: string, limit = 8): Promise<UserSearchResult[]> {
      const res = await context.client.api.users.search.$get({
        query: { q, limit: String(limit) },
      })
      return readJsonOrThrow<UserSearchResult[]>(res)
    },

    async fetchFollowers(handle: string): Promise<UserSearchResult[]> {
      const res = await context.client.api.users[":username"].followers.$get({
        param: { username: handle },
      })
      return readJsonOrThrow<UserSearchResult[]>(res)
    },

    async fetchFollowing(handle: string): Promise<UserSearchResult[]> {
      const res = await context.client.api.users[":username"].following.$get({
        param: { username: handle },
      })
      return readJsonOrThrow<UserSearchResult[]>(res)
    },

    async follow(handle: string): Promise<void> {
      const res = await context.client.api.users[":username"].follow.$post({
        param: { username: handle },
      })
      await readJsonOrThrow<{ following: true }>(res)
    },

    async unfollow(handle: string): Promise<void> {
      const res = await context.client.api.users[":username"].follow.$delete({
        param: { username: handle },
      })
      await readJsonOrThrow<{ following: false }>(res)
    },

    async block(handle: string): Promise<void> {
      const res = await context.client.api.users[":username"].block.$post({
        param: { username: handle },
      })
      await readJsonOrThrow<{ blocked: true }>(res)
    },

    async unblock(handle: string): Promise<void> {
      const res = await context.client.api.users[":username"].block.$delete({
        param: { username: handle },
      })
      await readJsonOrThrow<{ blocked: false }>(res)
    },

    async syncOAuthProfile(): Promise<void> {
      const res = await context.client.api.users.me["sync-oauth-profile"].$post()
      await readJsonOrThrow<{ synced: true }>(res)
    },
  }
}
