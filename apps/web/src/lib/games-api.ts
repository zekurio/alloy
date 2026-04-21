import { api } from "./api"
import type { ClipRow } from "./clips-api"
import { readJsonOrThrow } from "./http-error"

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

export async function fetchSteamGridDBStatus(): Promise<{
  steamgriddbConfigured: boolean
}> {
  const res = await api.api.games.status.$get()
  return readJsonOrThrow(res)
}

export async function searchGames(
  query: string
): Promise<SteamGridDBSearchResult[]> {
  const res = await api.api.games.search.$get({ query: { q: query } })
  return readJsonOrThrow(res)
}

export async function resolveGame(steamgriddbId: number): Promise<GameRow> {
  const res = await api.api.games.resolve.$post({
    json: { steamgriddbId },
  })
  return readJsonOrThrow(res)
}

/**
 * All games that have at least one visible ready clip, sorted by
 * clip count. Feeds the `/games` landscape grid.
 */
export async function fetchGames(): Promise<GameListRow[]> {
  const res = await api.api.games.$get()
  return readJsonOrThrow(res)
}

/** Single game lookup by slug — powers the `/g/:slug` banner. */
export async function fetchGame(slug: string): Promise<GameDetail> {
  const res = await api.api.games[":slug"].$get({ param: { slug } })
  return readJsonOrThrow(res)
}

export async function followGame(slug: string): Promise<{ following: true }> {
  const res = await api.api.games[":slug"].follow.$post({ param: { slug } })
  return readJsonOrThrow(res)
}

export async function unfollowGame(
  slug: string
): Promise<{ following: false }> {
  const res = await api.api.games[":slug"].follow.$delete({ param: { slug } })
  return readJsonOrThrow(res)
}

export interface GameClipsParams {
  sort?: "top" | "recent"
  limit?: number
  cursor?: string
}

export async function fetchGameClips(
  slug: string,
  params: GameClipsParams = {}
): Promise<ClipRow[]> {
  const query: Record<string, string> = {}
  if (params.sort) query.sort = params.sort
  if (params.limit !== undefined) query.limit = String(params.limit)
  if (params.cursor) query.cursor = params.cursor
  const res = await api.api.games[":slug"].clips.$get({
    param: { slug },
    query,
  })
  return readJsonOrThrow(res)
}

/**
 * Weighted "best of this game" — views + likes×3 with a recency decay.
 * Feeds the top-5 strip on the game detail page.
 */
export async function fetchGameTopClips(
  slug: string,
  limit = 5
): Promise<ClipRow[]> {
  const res = await api.api.games[":slug"]["top-clips"].$get({
    param: { slug },
    query: { limit: String(limit) },
  })
  return readJsonOrThrow(res)
}
