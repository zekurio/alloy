import type { SteamGridDBSearchResult } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { imageBlurHash } from "@alloy/server/media/blurhash"

import {
  getFirstGrid,
  getFirstHero,
  getFirstIcon,
  getFirstLogo,
  searchSteamGridDBGames,
} from "./steamgriddb-client"
export {
  getGameById,
  isConfigured,
  SteamGridDBError,
  SteamGridDBNotConfiguredError,
} from "./steamgriddb-client"

const logger = createLogger("steamgriddb")

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

export async function searchGames(
  query: string,
): Promise<SteamGridDBSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []
  return rankSearchResults(await searchSteamGridDBGames(trimmed), trimmed)
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

export async function getGameAssets(steamgriddbId: number): Promise<{
  heroUrl: string | null
  heroBlurHash: string | null
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
  const [heroBlurHash, gridBlurHash] = await Promise.all([
    computeGameAssetBlurHash("hero", steamgriddbId, hero?.url ?? null),
    computeGameAssetBlurHash("grid", steamgriddbId, grid?.url ?? null),
  ])
  return {
    heroUrl: hero?.url ?? null,
    heroBlurHash,
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
  if (!isSteamGridDBAssetUrl(url)) {
    logger.warn(
      `rejected ${label} blurhash URL for ${steamgriddbId}: unexpected origin`,
    )
    return null
  }
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

function isSteamGridDBAssetUrl(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value)
    return (
      protocol === "https:" &&
      (hostname === "steamgriddb.com" || hostname.endsWith(".steamgriddb.com"))
    )
  } catch {
    return false
  }
}
