import type { ApiContext } from "./client"
import type { ClipRow } from "./clips"
import { readJsonOrThrow } from "./http"

export interface SteamGridDBSearchResult {
  id: number
  name: string
  release_date?: number
  types?: string[]
  verified?: boolean
  iconUrl?: string | null
}

export interface GameRow {
  id: string
  steamgriddbId: number
  name: string
  slug: string
  releaseDate: string | null
  heroUrl: string | null
  logoUrl: string | null
  iconUrl: string | null
}

export interface GameListRow extends GameRow {
  clipCount: number
}

export interface GameDetail extends GameRow {
  viewer: { isFollowing: boolean } | null
}

export interface GameClipsParams {
  sort?: "top" | "recent"
  limit?: number
  cursor?: string
}

export function createGamesApi(context: ApiContext) {
  return {
    async fetchSteamGridDBStatus(): Promise<{
      steamgriddbConfigured: boolean
    }> {
      const res = await context.client.api.games.status.$get()
      return readJsonOrThrow(res)
    },

    async search(query: string): Promise<SteamGridDBSearchResult[]> {
      const res = await context.client.api.games.search.$get({
        query: { q: query },
      })
      return readJsonOrThrow(res)
    },

    async resolve(steamgriddbId: number): Promise<GameRow> {
      const res = await context.client.api.games.resolve.$post({
        json: { steamgriddbId },
      })
      return readJsonOrThrow(res)
    },

    async fetchAll(): Promise<GameListRow[]> {
      const res = await context.client.api.games.$get()
      return readJsonOrThrow(res)
    },

    async fetchBySlug(slug: string): Promise<GameDetail> {
      const res = await context.client.api.games[":slug"].$get({
        param: { slug },
      })
      return readJsonOrThrow(res)
    },

    async follow(slug: string): Promise<{ following: true }> {
      const res = await context.client.api.games[":slug"].follow.$post({
        param: { slug },
      })
      return readJsonOrThrow(res)
    },

    async unfollow(slug: string): Promise<{ following: false }> {
      const res = await context.client.api.games[":slug"].follow.$delete({
        param: { slug },
      })
      return readJsonOrThrow(res)
    },

    async fetchClips(
      slug: string,
      params: GameClipsParams = {}
    ): Promise<ClipRow[]> {
      const query: Record<string, string> = {}
      if (params.sort) query.sort = params.sort
      if (params.limit !== undefined) query.limit = String(params.limit)
      if (params.cursor) query.cursor = params.cursor
      const res = await context.client.api.games[":slug"].clips.$get({
        param: { slug },
        query,
      })
      return readJsonOrThrow(res)
    },

    async fetchTopClips(slug: string, limit = 5): Promise<ClipRow[]> {
      const res = await context.client.api.games[":slug"]["top-clips"].$get({
        param: { slug },
        query: { limit: String(limit) },
      })
      return readJsonOrThrow(res)
    },
  }
}
