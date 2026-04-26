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

function gamePath(slug: string, suffix = "") {
  return `/api/games/${encodeURIComponent(slug)}${suffix}`
}

async function fetchSteamGridDBStatus(
  context: ApiContext
): Promise<SteamGridDBStatus> {
  const res = await context.request("/api/games/status")
  return readJsonOrThrow(res)
}

async function searchGames(
  context: ApiContext,
  query: string
): Promise<SteamGridDBSearchResult[]> {
  const res = await context.request("/api/games/search", {
    query: { q: query },
  })
  return readJsonOrThrow(res)
}

async function resolveGame(
  context: ApiContext,
  steamgriddbId: number
): Promise<GameRow> {
  const res = await context.request("/api/games/resolve", {
    method: "POST",
    json: { steamgriddbId },
  })
  return readJsonOrThrow(res)
}

async function fetchAllGames(
  context: ApiContext,
  params: { limit?: number; offset?: number } = {}
): Promise<GameListRow[]> {
  const res = await context.request("/api/games", {
    query: {
      ...(params.limit !== undefined ? { limit: String(params.limit) } : {}),
      ...(params.offset !== undefined ? { offset: String(params.offset) } : {}),
    },
  })
  return readJsonOrThrow(res)
}

async function fetchGameBySlug(
  context: ApiContext,
  slug: string
): Promise<GameDetail> {
  const res = await context.request(gamePath(slug))
  return readJsonOrThrow(res)
}

async function setGameFollow(
  context: ApiContext,
  slug: string,
  following: boolean
): Promise<{ following: boolean }> {
  const res = await context.request(gamePath(slug, "/follow"), {
    method: following ? "POST" : "DELETE",
  })
  return readJsonOrThrow(res)
}

async function fetchGameClips(
  context: ApiContext,
  slug: string,
  params: GameClipsParams = {}
): Promise<ClipRow[]> {
  const query: Record<string, string> = {}
  if (params.sort) query.sort = params.sort
  if (params.limit !== undefined) query.limit = String(params.limit)
  if (params.cursor) query.cursor = params.cursor
  const res = await context.request(gamePath(slug, "/clips"), { query })
  return readJsonOrThrow(res)
}

async function fetchGameTopClips(
  context: ApiContext,
  slug: string,
  limit = 5
): Promise<ClipRow[]> {
  const res = await context.request(gamePath(slug, "/top-clips"), {
    query: { limit: String(limit) },
  })
  return readJsonOrThrow(res)
}

export function createGamesApi(context: ApiContext) {
  return {
    fetchSteamGridDBStatus: () => fetchSteamGridDBStatus(context),
    search: (query: string) => searchGames(context, query),
    resolve: (steamgriddbId: number) => resolveGame(context, steamgriddbId),
    fetchAll: (params: { limit?: number; offset?: number } = {}) =>
      fetchAllGames(context, params),
    fetchBySlug: (slug: string) => fetchGameBySlug(context, slug),
    favorite: (slug: string) =>
      setGameFollow(context, slug, true) as Promise<{ following: true }>,
    unfavorite: (slug: string) =>
      setGameFollow(context, slug, false) as Promise<{ following: false }>,
    follow: (slug: string) =>
      setGameFollow(context, slug, true) as Promise<{ following: true }>,
    unfollow: (slug: string) =>
      setGameFollow(context, slug, false) as Promise<{ following: false }>,
    fetchClips: (slug: string, params: GameClipsParams = {}) =>
      fetchGameClips(context, slug, params),
    fetchTopClips: (slug: string, limit = 5) =>
      fetchGameTopClips(context, slug, limit),
  }
}
