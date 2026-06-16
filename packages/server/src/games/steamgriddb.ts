import type {
  GameRow,
  SteamGridDBAsset,
  SteamGridDBGameDetail,
  SteamGridDBSearchResult,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { secretStore } from "@alloy/server/config/secret-store"
import { deriveAccentColorFromUrl } from "@alloy/server/media/accent"
import { imageBlurHash } from "@alloy/server/media/blurhash"
import { errorMessage, isAbortError } from "@alloy/server/runtime/error-message"
import { z } from "zod"

import { gameSlugWithId } from "./slug"

const logger = createLogger("steamgriddb")

const STEAMGRIDDB_ORIGIN = "https://www.steamgriddb.com"
const STEAMGRIDDB_API_PATH = "/api/v2"

const HERO_DIMENSIONS = "1920x620,3840x1240"
const GRID_DIMENSIONS = "600x900,342x482,660x930"

const REQUEST_TIMEOUT_MS = 10_000

export class SteamGridDBError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
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

const EnvelopeSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    success: z.boolean(),
    errors: z.array(z.string()).optional(),
    data: inner.optional(),
  })

// Autocomplete row. `release_date` is a Unix timestamp in seconds when
// present; SGDB omits it for some games (mods, unknown releases).
const SearchResultSchema: z.ZodType<SteamGridDBSearchResult> = z.object({
  id: z.number().int(),
  name: z.string(),
  release_date: z.number().int().optional(),
  types: z.array(z.string()).optional(),
  verified: z.boolean().optional(),
})

const GameDetailSchema: z.ZodType<SteamGridDBGameDetail> = z.object({
  id: z.number().int(),
  name: z.string(),
  release_date: z.number().int().optional().nullable(),
  types: z.array(z.string()).optional(),
  verified: z.boolean().optional(),
})

const AssetSchema: z.ZodType<SteamGridDBAsset> = z.object({
  id: z.number().int(),
  url: z.string().url(),
  thumb: z.string().url().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  style: z.string().optional(),
  nsfw: z.boolean().optional(),
  humor: z.boolean().optional(),
})

const SearchEnvelope = EnvelopeSchema(z.array(SearchResultSchema))
const GameDetailEnvelope = EnvelopeSchema(GameDetailSchema)
const AssetListEnvelope = EnvelopeSchema(z.array(AssetSchema))

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
}

function searchResultScore(
  result: SteamGridDBSearchResult,
  normalizedQuery: string,
): number {
  const normalizedName = normalizeSearchText(result.name)
  const types = result.types?.map((type) => type.toLowerCase()) ?? []

  let score = 0
  if (normalizedName === normalizedQuery) score += 800
  else if (normalizedName.startsWith(normalizedQuery)) score += 500
  else if (normalizedName.includes(normalizedQuery)) score += 250

  if (result.verified) score += 120
  if (types.includes("game")) score += 80
  if (result.release_date) score += 20

  if (types.some((type) => ["dlc", "demo", "mod"].includes(type))) score -= 160

  return score
}

function rankSearchResults(
  results: SteamGridDBSearchResult[],
  query: string,
): SteamGridDBSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery.length === 0) return results

  return results
    .map((result, index) => ({
      index,
      result,
      score: searchResultScore(result, normalizedQuery),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ result }) => result)
}

function getApiKey(): string {
  const key = secretStore.get("steamgriddbApiKey")
  if (!key || key.length === 0) {
    throw new SteamGridDBNotConfiguredError()
  }
  return key
}

async function sgdbFetch<T>(
  path: string,
  envelope: z.ZodType<{ success: boolean; errors?: string[]; data?: T }>,
  query?: Record<string, string>,
): Promise<T | null> {
  const apiKey = getApiKey()
  const url = new URL(`${STEAMGRIDDB_API_PATH}${path}`, STEAMGRIDDB_ORIGIN)
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
    if (isAbortError(err)) {
      throw new SteamGridDBError("SteamGridDB request timed out", null)
    }
    throw new SteamGridDBError(
      errorMessage(err, "SteamGridDB request failed"),
      null,
    )
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 404) return null
  if (!res.ok) {
    throw new SteamGridDBError(
      `SteamGridDB responded ${res.status} ${res.statusText}`,
      res.status,
    )
  }

  let json: unknown
  try {
    json = await res.json()
  } catch (err) {
    throw new SteamGridDBError(
      errorMessage(err, "SteamGridDB returned invalid JSON"),
      res.status,
    )
  }
  const parsed = envelope.safeParse(json)
  if (!parsed.success) {
    throw new SteamGridDBError(
      `Unexpected SteamGridDB response shape: ${parsed.error.message}`,
      res.status,
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

export async function searchGames(
  query: string,
): Promise<SteamGridDBSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []
  const data = await sgdbFetch(
    `/search/autocomplete/${encodeURIComponent(trimmed)}`,
    SearchEnvelope,
  )
  return rankSearchResults(data ?? [], trimmed)
}

export async function gameRowFromSearchResult(
  result: SteamGridDBSearchResult,
): Promise<GameRow> {
  const [enriched] = await enrichSearchResultsWithIcons([result], 1)
  const releaseDate =
    typeof result.release_date === "number"
      ? new Date(result.release_date * 1000).toISOString()
      : null

  return {
    id: result.id,
    steamgriddbId: result.id,
    name: result.name,
    slug: gameSlugWithId(result.name, result.id),
    releaseDate,
    heroUrl: null,
    heroBlurHash: null,
    gridUrl: null,
    gridBlurHash: null,
    logoUrl: enriched?.logoUrl ?? null,
    iconUrl: enriched?.iconUrl ?? null,
    accentColor: null,
  }
}

const ICON_CACHE_MAX = 512
const iconUrlCache = new Map<number, string | null>()
const logoUrlCache = new Map<number, string | null>()

function cacheGet(
  cache: Map<number, string | null>,
  id: number,
): string | null | undefined {
  if (!cache.has(id)) return undefined
  const value = cache.get(id)
  // Touch LRU order: delete + re-insert puts it at the tail.
  cache.delete(id)
  cache.set(id, value ?? null)
  return value ?? null
}

function cacheSet(
  cache: Map<number, string | null>,
  id: number,
  url: string | null,
) {
  if (cache.has(id)) cache.delete(id)
  cache.set(id, url)
  if (cache.size > ICON_CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

async function resolveIconUrl(id: number): Promise<string | null> {
  const cached = cacheGet(iconUrlCache, id)
  if (cached !== undefined) return cached
  const asset = await optionalSteamGridDBAsset("icon", id, () =>
    getFirstIcon(id),
  )
  const url = asset?.url ?? null
  cacheSet(iconUrlCache, id, url)
  return url
}

async function resolveLogoUrl(id: number): Promise<string | null> {
  const cached = cacheGet(logoUrlCache, id)
  if (cached !== undefined) return cached
  const asset = await optionalSteamGridDBAsset("logo", id, () =>
    getFirstLogo(id),
  )
  const url = asset?.url ?? null
  cacheSet(logoUrlCache, id, url)
  return url
}

async function optionalSteamGridDBAsset<T>(
  label: string,
  steamgriddbId: number,
  load: () => Promise<T | null>,
): Promise<T | null> {
  try {
    return await load()
  } catch (err) {
    logger.warn(`failed to fetch ${label} for ${steamgriddbId}:`, err)
    return null
  }
}

export async function enrichSearchResultsWithIcons(
  results: SteamGridDBSearchResult[],
  topN: number,
): Promise<
  Array<
    SteamGridDBSearchResult & { iconUrl: string | null; logoUrl: string | null }
  >
> {
  const head = results.slice(0, topN)
  const tail = results.slice(topN)
  const assets = await Promise.all(
    head.map(async (r) => {
      const iconUrl = await resolveIconUrl(r.id)
      const logoUrl = iconUrl ? null : await resolveLogoUrl(r.id)
      return { iconUrl, logoUrl }
    }),
  )
  return [
    ...head.map((r, i) => ({
      ...r,
      iconUrl: assets[i]?.iconUrl ?? null,
      logoUrl: assets[i]?.logoUrl ?? null,
    })),
    ...tail.map((r) => ({ ...r, iconUrl: null, logoUrl: null })),
  ]
}

export async function getGameById(
  steamgriddbId: number,
): Promise<SteamGridDBGameDetail | null> {
  return await sgdbFetch(`/games/id/${steamgriddbId}`, GameDetailEnvelope)
}

async function getFirstHero(
  steamgriddbId: number,
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/heroes/game/${steamgriddbId}`,
    AssetListEnvelope,
    { dimensions: HERO_DIMENSIONS },
  )
  return data?.[0] ?? null
}

async function getFirstGrid(
  steamgriddbId: number,
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/grids/game/${steamgriddbId}`,
    AssetListEnvelope,
    { dimensions: GRID_DIMENSIONS },
  )
  return data?.[0] ?? null
}

async function getFirstLogo(
  steamgriddbId: number,
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/logos/game/${steamgriddbId}`,
    AssetListEnvelope,
  )
  return data?.[0] ?? null
}

async function getFirstIcon(
  steamgriddbId: number,
): Promise<SteamGridDBAsset | null> {
  const data = await sgdbFetch(
    `/icons/game/${steamgriddbId}`,
    AssetListEnvelope,
  )
  return data?.[0] ?? null
}

export async function getGameAssets(steamgriddbId: number): Promise<{
  heroUrl: string | null
  heroBlurHash: string | null
  heroAccent: string | null
  gridUrl: string | null
  gridBlurHash: string | null
  logoUrl: string | null
  iconUrl: string | null
}> {
  const [hero, grid, logo, icon] = await Promise.all([
    optionalSteamGridDBAsset("hero", steamgriddbId, () =>
      getFirstHero(steamgriddbId),
    ),
    optionalSteamGridDBAsset("grid", steamgriddbId, () =>
      getFirstGrid(steamgriddbId),
    ),
    optionalSteamGridDBAsset("logo", steamgriddbId, () =>
      getFirstLogo(steamgriddbId),
    ),
    optionalSteamGridDBAsset("icon", steamgriddbId, () =>
      getFirstIcon(steamgriddbId),
    ),
  ])
  const [heroBlurHash, gridBlurHash, heroAccent] = await Promise.all([
    computeGameAssetBlurHash("hero", steamgriddbId, hero?.url ?? null),
    computeGameAssetBlurHash("grid", steamgriddbId, grid?.url ?? null),
    hero?.url
      ? deriveAccentColorFromUrl(
          hero.url,
          `SteamGridDB hero accent ${steamgriddbId}`,
        )
      : Promise.resolve(null),
  ])
  return {
    heroUrl: hero?.url ?? null,
    heroBlurHash,
    heroAccent,
    gridUrl: grid?.url ?? null,
    gridBlurHash,
    logoUrl: logo?.url ?? null,
    iconUrl: icon?.url ?? null,
  }
}

async function computeGameAssetBlurHash(
  label: "hero" | "grid",
  steamgriddbId: number,
  url: string | null,
): Promise<string | null> {
  if (!url) return null
  try {
    return await imageBlurHash({
      source: url,
      label: `SteamGridDB ${label} blurhash`,
    })
  } catch (err) {
    logger.warn(
      `failed to compute ${label} blurhash for ${steamgriddbId}:`,
      err,
    )
    return null
  }
}

export function isConfigured(): boolean {
  const key = secretStore.get("steamgriddbApiKey")
  return typeof key === "string" && key.length > 0
}
