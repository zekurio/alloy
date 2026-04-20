import { z } from "zod"

import { configStore } from "./config-store"

/**
 * Thin SteamGridDB API client.
 *
 * SteamGridDB exposes a JSON v2 API at https://www.steamgriddb.com/api/v2;
 * every call carries a Bearer token. We only use three endpoints:
 *
 *   - `GET /search/autocomplete/:query` — name-based game search, used by
 *     the upload modal's game picker. Cheap, returns id/name/release_date.
 *   - `GET /heroes/game/:id` — landscape banners (the `hero_url` we store).
 *     We filter by the two standard hero dimensions so the CDN URL we pin
 *     always points at a banner-shaped asset.
 *   - `GET /logos/game/:id` — transparent game logos overlaid on heroes.
 *
 * The API key is admin-tunable via `configStore.integrations.steamgriddbApiKey`;
 * when unset, every call returns a "not configured" error so the UI can
 * fall back to free-text labels without crashing. Admin key rotations
 * take effect immediately — we read the key per request, not at boot.
 *
 * HTTP failures surface as `SteamGridDBError` (never a generic Error)
 * so the route handlers can separate transport problems from "no
 * matching game" misses. 404s on game detail are modelled as `null`
 * so callers don't have to try/catch the happy path.
 */

const BASE_URL = "https://www.steamgriddb.com/api/v2"

// SGDB's hero endpoint returns many dimensions; filter to the two
// standard banner sizes so we always store a landscape-shaped URL.
// `dimensions=1920x620,3840x1240` matches what Steam itself uses for
// game library banners and is what Fireshare pins on too.
const HERO_DIMENSIONS = "1920x620,3840x1240"

// Keep the HTTP budget tight — SGDB is fast but we hit it inline during
// the upload flow, so a slow lookup would stall the publish button. A
// 10s timeout is generous for a JSON fetch and still fails well before
// the upload modal's own timeout.
const REQUEST_TIMEOUT_MS = 10_000

export class SteamGridDBError extends Error {
  constructor(
    message: string,
    public readonly status: number | null
  ) {
    super(message)
    this.name = "SteamGridDBError"
  }
}

export class SteamGridDBNotConfiguredError extends SteamGridDBError {
  constructor() {
    super("SteamGridDB API key is not configured.", null)
    this.name = "SteamGridDBNotConfiguredError"
  }
}

// ─── Response schemas ──────────────────────────────────────────────────

/**
 * Shape shared by every SGDB v2 response envelope. `success` flags
 * whether the request was accepted by SGDB; `errors` carries the
 * server's message when it wasn't. `data` is the payload when success.
 */
const EnvelopeSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    success: z.boolean(),
    errors: z.array(z.string()).optional(),
    data: inner.optional(),
  })

// Autocomplete row. `release_date` is a Unix timestamp in seconds when
// present; SGDB omits it for some games (mods, unknown releases).
const SearchResultSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  release_date: z.number().int().optional(),
  types: z.array(z.string()).optional(),
  verified: z.boolean().optional(),
})

export type SteamGridDBSearchResult = z.infer<typeof SearchResultSchema>

const GameDetailSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  release_date: z.number().int().optional().nullable(),
  types: z.array(z.string()).optional(),
  verified: z.boolean().optional(),
})

export type SteamGridDBGameDetail = z.infer<typeof GameDetailSchema>

// Asset row. SGDB uses this shape for heroes, logos, grids, icons —
// the only relevant fields for us are `url` (CDN pointer) and `thumb`
// (smaller preview we surface in the asset-picker UI if we add one).
const AssetSchema = z.object({
  id: z.number().int(),
  url: z.string().url(),
  thumb: z.string().url().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  style: z.string().optional(),
  nsfw: z.boolean().optional(),
  humor: z.boolean().optional(),
})

export type SteamGridDBAsset = z.infer<typeof AssetSchema>

const SearchEnvelope = EnvelopeSchema(z.array(SearchResultSchema))
const GameDetailEnvelope = EnvelopeSchema(GameDetailSchema)
const AssetListEnvelope = EnvelopeSchema(z.array(AssetSchema))

// ─── Internals ─────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = configStore.get("integrations").steamgriddbApiKey
  if (!key || key.length === 0) {
    throw new SteamGridDBNotConfiguredError()
  }
  return key
}

/**
 * Fetch a SGDB endpoint, parse the envelope, return `data`.
 *
 * We parse through zod rather than casting so a SGDB API shape change
 * fails loudly in one place instead of silently deserialising garbage
 * into DB rows. The zod parse error is re-thrown as `SteamGridDBError`
 * so route handlers only ever see one error class from this module.
 *
 * 404 is modelled as `null` on the caller side — for game detail lookups
 * that's the "no such SGDB id" case, which callers handle as "user
 * picked a stale id" rather than "API broken".
 */
async function sgdbFetch<T>(
  path: string,
  envelope: z.ZodType<{ success: boolean; errors?: string[]; data?: T }>,
  query?: Record<string, string>
): Promise<T | null> {
  const apiKey = getApiKey()
  const url = new URL(`${BASE_URL}${path}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new SteamGridDBError("SteamGridDB request timed out", null)
    }
    throw new SteamGridDBError(
      err instanceof Error ? err.message : "SteamGridDB request failed",
      null
    )
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 404) return null
  if (!res.ok) {
    throw new SteamGridDBError(
      `SteamGridDB responded ${res.status} ${res.statusText}`,
      res.status
    )
  }

  const json: unknown = await res.json().catch(() => null)
  const parsed = envelope.safeParse(json)
  if (!parsed.success) {
    throw new SteamGridDBError(
      `Unexpected SteamGridDB response shape: ${parsed.error.message}`,
      res.status
    )
  }
  if (!parsed.data.success) {
    const msg = parsed.data.errors?.join(", ") ?? "unknown error"
    throw new SteamGridDBError(`SteamGridDB error: ${msg}`, res.status)
  }
  // SGDB returns `success: true` with no `data` for some empty lookups;
  // we never treat that as an error, the caller normalises.
  return (parsed.data.data ?? null) as T | null
}

// ─── Public surface ────────────────────────────────────────────────────

/**
 * Search SteamGridDB for games matching `query`. Feeds the upload
 * modal's game-picker autocomplete — we pass the user's partial input
 * straight through and SGDB does the fuzzy match. Results are unsorted
 * by us; SGDB returns them ranked by its own popularity heuristic.
 *
 * Empty / whitespace queries short-circuit to an empty list so we don't
 * spend a round trip on a keystroke the user hasn't finished.
 */
export async function searchGames(
  query: string
): Promise<SteamGridDBSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []
  const data = await sgdbFetch(
    `/search/autocomplete/${encodeURIComponent(trimmed)}`,
    SearchEnvelope
  )
  return data ?? []
}

/**
 * Look up a game by its SteamGridDB id. Returns `null` when SGDB
 * doesn't know the id — handles the "uploader picked a stale suggestion"
 * case without throwing.
 */
export async function getGameById(
  steamgriddbId: number
): Promise<SteamGridDBGameDetail | null> {
  return await sgdbFetch(`/games/id/${steamgriddbId}`, GameDetailEnvelope)
}

/**
 * First hero (landscape banner) for a SGDB game. Returns `null` when
 * the game has no heroes uploaded — a real outcome on obscure titles,
 * not an error. We pick the top result; SGDB orders by its internal
 * quality heuristic so that's the "best" landscape we can ship without
 * adding an asset-picker UI.
 */
export async function getFirstHero(
  steamgriddbId: number
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/heroes/game/${steamgriddbId}`,
    AssetListEnvelope,
    { dimensions: HERO_DIMENSIONS }
  )
  return data?.[0] ?? null
}

/**
 * First logo (transparent) for a SGDB game. Same "null on empty"
 * semantics as heroes — the /g/:slug page falls back to rendering the
 * game name when no logo is available.
 */
export async function getFirstLogo(
  steamgriddbId: number
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/logos/game/${steamgriddbId}`,
    AssetListEnvelope
  )
  return data?.[0] ?? null
}

/**
 * Batched asset lookup used by the game-upsert route. Fetches the
 * first hero + first logo in parallel and returns URLs (or nulls).
 * Split out so the upsert route stays focused on DB work rather than
 * HTTP orchestration.
 */
export async function getGameAssets(
  steamgriddbId: number
): Promise<{ heroUrl: string | null; logoUrl: string | null }> {
  const [hero, logo] = await Promise.all([
    getFirstHero(steamgriddbId).catch(() => null),
    getFirstLogo(steamgriddbId).catch(() => null),
  ])
  return {
    heroUrl: hero?.url ?? null,
    logoUrl: logo?.url ?? null,
  }
}

/**
 * True when the admin has set a SteamGridDB API key. The /api/games/*
 * routes gate their SGDB-touching endpoints on this so we return a
 * clean 503 instead of a thrown error when the integration hasn't
 * been configured.
 */
export function isConfigured(): boolean {
  const key = configStore.get("integrations").steamgriddbApiKey
  return typeof key === "string" && key.length > 0
}
