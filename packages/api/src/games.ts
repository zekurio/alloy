import type { ApiContext } from "./client"
import type {
  ClipRow,
  GameClipsParams,
  GameDetail,
  GameListRow,
  GameRow,
  SteamGridDBSearchResult,
  SteamGridDBStatus,
} from "@workspace/contracts"
import { readJsonOrThrow } from "./http"

export type {
  GameClipsParams,
  GameDetail,
  GameListRow,
  GameRow,
  SteamGridDBSearchResult,
  SteamGridDBStatus,
} from "@workspace/contracts"

export function createGamesApi(context: ApiContext) {
  return {
    async fetchSteamGridDBStatus(): Promise<SteamGridDBStatus> {
      const res = await context.request("/api/games/status")
      return readJsonOrThrow(res)
    },

    async search(query: string): Promise<SteamGridDBSearchResult[]> {
      const res = await context.request("/api/games/search", {
        query: { q: query },
      })
      return readJsonOrThrow(res)
    },

    async resolve(steamgriddbId: number): Promise<GameRow> {
      const res = await context.request("/api/games/resolve", {
        method: "POST",
        json: { steamgriddbId },
      })
      return readJsonOrThrow(res)
    },

    async fetchAll(): Promise<GameListRow[]> {
      const res = await context.request("/api/games")
      return readJsonOrThrow(res)
    },

    async fetchBySlug(slug: string): Promise<GameDetail> {
      const res = await context.request(
        `/api/games/${encodeURIComponent(slug)}`
      )
      return readJsonOrThrow(res)
    },

    async favorite(slug: string): Promise<{ following: true }> {
      const res = await context.request(
        `/api/games/${encodeURIComponent(slug)}/follow`,
        { method: "POST" }
      )
      return readJsonOrThrow(res)
    },

    async unfavorite(slug: string): Promise<{ following: false }> {
      const res = await context.request(
        `/api/games/${encodeURIComponent(slug)}/follow`,
        { method: "DELETE" }
      )
      return readJsonOrThrow(res)
    },

    async follow(slug: string): Promise<{ following: true }> {
      const res = await context.request(
        `/api/games/${encodeURIComponent(slug)}/follow`,
        { method: "POST" }
      )
      return readJsonOrThrow(res)
    },

    async unfollow(slug: string): Promise<{ following: false }> {
      const res = await context.request(
        `/api/games/${encodeURIComponent(slug)}/follow`,
        { method: "DELETE" }
      )
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
      const res = await context.request(
        `/api/games/${encodeURIComponent(slug)}/clips`,
        {
          query,
        }
      )
      return readJsonOrThrow(res)
    },

    async fetchTopClips(slug: string, limit = 5): Promise<ClipRow[]> {
      const res = await context.request(
        `/api/games/${encodeURIComponent(slug)}/top-clips`,
        { query: { limit: String(limit) } }
      )
      return readJsonOrThrow(res)
    },
  }
}
