import { api } from "./api"
import type { ClipRow } from "./clips-api"
import { readJsonOrThrow } from "./http-error"

/**
 * Client wrappers for `/api/games/*`. Two shapes show up here:
 *
 *   - SteamGridDB search results (`SteamGridDBSearchResult`) — what the
 *     upload modal's autocomplete renders; comes from the SGDB API
 *     proxied through our server so the key stays hidden.
 *   - Our own `game` table rows (`GameRow`) — what's pinned to the
 *     DB once an uploader resolves a SGDB id. Carries CDN URLs for
 *     hero + logo so the /g/:slug page can paint the banner without
 *     touching SGDB again.
 *
 * Every wrapper throws on non-2xx so callers can `try/catch` at the
 * component boundary.
 */

/**
 * Raw SteamGridDB autocomplete row. `types`/`verified` come straight
 * from SGDB — we don't use them yet but keep them on the shape so the
 * picker UI can show badges (e.g. "official release" vs "mod") without
 * a contract change later.
 */
export interface SteamGridDBSearchResult {
  id: number
  name: string
  release_date?: number
  types?: string[]
  verified?: boolean
}

export interface GameRow {
  id: string
  steamgriddbId: number
  name: string
  slug: string
  releaseDate: string | null
  heroUrl: string | null
  logoUrl: string | null
}

export interface GameListRow extends GameRow {
  clipCount: number
}

/**
 * Is SteamGridDB wired up on this instance? Cheap boolean — the upload
 * modal hits this on mount to decide whether to surface the mapped
 * game picker (`true`) or fall back to a disabled state (`false`).
 */
export async function fetchSteamGridDBStatus(): Promise<{
  steamgriddbConfigured: boolean
}> {
  const res = await api.api.games.status.$get()
  return readJsonOrThrow(res)
}

/**
 * Proxy SGDB's autocomplete through our server. Empty/whitespace
 * queries short-circuit to an empty list server-side so typing into
 * the picker doesn't burn a round trip per keystroke.
 */
export async function searchGames(
  query: string
): Promise<SteamGridDBSearchResult[]> {
  const res = await api.api.games.search.$get({ query: { q: query } })
  return readJsonOrThrow(res)
}

/**
 * Upsert a game row for the picked SGDB id. Idempotent — subsequent
 * uploads for the same game reuse the existing row without a fresh
 * SGDB round trip. Returns the full `GameRow` so the upload modal
 * can preview the hero before the clip is saved.
 */
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
export async function fetchGame(slug: string): Promise<GameRow> {
  const res = await api.api.games[":slug"].$get({ param: { slug } })
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
