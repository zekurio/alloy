import type {
  GameAssetRole,
  SteamGridDBAsset,
  SteamGridDBSearchResult,
} from "@alloy/contracts"
import { game } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { imageBlurHash } from "@alloy/server/media/blurhash"
import { inArray } from "drizzle-orm"

import {
  fetchFirstGameAsset,
  type GameAssetFetch,
  listGameAssets,
  searchSteamGridDBGames,
} from "./steamgriddb-client"
export { getGameById, SteamGridDBError } from "./steamgriddb-client"

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

type SearchArtwork = { iconUrl: string | null; logoUrl: string | null }

/**
 * Artwork for games the catalogue already knows, keyed by SteamGridDB id.
 * Their rows are the source of truth (an admin may have replaced the icon),
 * and reading them costs no upstream call.
 */
async function knownSearchArtwork(
  steamgriddbIds: number[],
): Promise<Map<number, SearchArtwork>> {
  const known = new Map<number, SearchArtwork>()
  if (steamgriddbIds.length === 0) return known
  const rows = await db
    .select({
      steamgriddbId: game.steamgriddb_id,
      iconUrl: game.icon_url,
      logoUrl: game.logo_url,
    })
    .from(game)
    .where(inArray(game.steamgriddb_id, steamgriddbIds))
  for (const row of rows) {
    if (row.steamgriddbId === null) continue
    known.set(row.steamgriddbId, { iconUrl: row.iconUrl, logoUrl: row.logoUrl })
  }
  return known
}

async function upstreamSearchArtwork(
  steamgriddbId: number,
): Promise<SearchArtwork> {
  const icon = await fetchFirstGameAsset(steamgriddbId, "icon")
  if (icon.kind === "asset") return { iconUrl: icon.asset.url, logoUrl: null }
  if (icon.kind === "failed") {
    logger.warn(`failed to fetch icon for ${steamgriddbId}:`, icon.error)
    return { iconUrl: null, logoUrl: null }
  }
  const logo = await fetchFirstGameAsset(steamgriddbId, "logo")
  if (logo.kind === "failed") {
    logger.warn(`failed to fetch logo for ${steamgriddbId}:`, logo.error)
  }
  return {
    iconUrl: null,
    logoUrl: logo.kind === "asset" ? logo.asset.url : null,
  }
}

/**
 * Adds an icon (or logo) to the first `topN` results. Known games answer from
 * their rows; the rest cost up to two SteamGridDB listings each, bounded and
 * cached by the client layer.
 */
export async function enrichSearchResultsWithIcons(
  results: SteamGridDBSearchResult[],
  topN: number,
): Promise<Array<SteamGridDBSearchResult & SearchArtwork>> {
  const head = results.slice(0, topN)
  const tail = results.slice(topN)
  const known = await knownSearchArtwork(head.map((result) => result.id))
  const artwork = await Promise.all(
    head.map(
      async (result) =>
        known.get(result.id) ?? (await upstreamSearchArtwork(result.id)),
    ),
  )
  return [
    ...head.map((result, index) => ({
      ...result,
      iconUrl: artwork[index]?.iconUrl ?? null,
      logoUrl: artwork[index]?.logoUrl ?? null,
    })),
    ...tail.map((result) => ({ ...result, iconUrl: null, logoUrl: null })),
  ]
}

const GAME_ARTWORK_MAX = 60

/**
 * Selectable SteamGridDB artwork for one role, powering the admin artwork
 * picker. Upstream failures propagate (unlike ingestion, which degrades) so the
 * route can answer 502/503 instead of showing an empty picker.
 */
export async function browseGameArtwork(
  steamgriddbId: number,
  role: GameAssetRole,
): Promise<SteamGridDBAsset[]> {
  const assets = await listGameAssets(steamgriddbId, role)
  return assets.slice(0, GAME_ARTWORK_MAX)
}

/**
 * The first asset per role for ingestion. Each role tells "SteamGridDB lists
 * nothing" apart from "the listing failed" so a refresh during an outage
 * keeps the artwork a game already has.
 */
export type GameArtwork = {
  hero: GameAssetFetch
  heroBlurHash: string | null
  grid: GameAssetFetch
  gridBlurHash: string | null
  logo: GameAssetFetch
  icon: GameAssetFetch
}

export function artworkUrl(fetched: GameAssetFetch): string | null {
  return fetched.kind === "asset" ? fetched.asset.url : null
}

export function artworkFailed(artwork: GameArtwork): boolean {
  return [artwork.hero, artwork.grid, artwork.logo, artwork.icon].some(
    (fetched) => fetched.kind === "failed",
  )
}

/** Stored artwork whose BlurHash a refresh reuses while its URL is unchanged. */
type KnownArtwork = {
  heroUrl: string | null
  heroBlurHash: string | null
  gridUrl: string | null
  gridBlurHash: string | null
}

export async function getGameArtwork(
  steamgriddbId: number,
  known: KnownArtwork | null,
): Promise<GameArtwork> {
  const [hero, grid, logo, icon] = await Promise.all([
    fetchFirstGameAsset(steamgriddbId, "hero"),
    fetchFirstGameAsset(steamgriddbId, "grid"),
    fetchFirstGameAsset(steamgriddbId, "logo"),
    fetchFirstGameAsset(steamgriddbId, "icon"),
  ])
  for (const [label, fetched] of [
    ["hero", hero],
    ["grid", grid],
    ["logo", logo],
    ["icon", icon],
  ] as const) {
    if (fetched.kind === "failed") {
      logger.warn(
        `failed to fetch ${label} for ${steamgriddbId}:`,
        fetched.error,
      )
    }
  }
  const [heroBlurHash, gridBlurHash] = await Promise.all([
    gameAssetBlurHash("hero", steamgriddbId, artworkUrl(hero), {
      url: known?.heroUrl ?? null,
      blurHash: known?.heroBlurHash ?? null,
    }),
    gameAssetBlurHash("grid", steamgriddbId, artworkUrl(grid), {
      url: known?.gridUrl ?? null,
      blurHash: known?.gridBlurHash ?? null,
    }),
  ])
  return { hero, heroBlurHash, grid, gridBlurHash, logo, icon }
}

async function gameAssetBlurHash(
  label: "hero" | "grid",
  steamgriddbId: number,
  url: string | null,
  known: { url: string | null; blurHash: string | null },
): Promise<string | null> {
  if (!url) return null
  // Downloading the image again would only reproduce the stored hash.
  if (url === known.url && known.blurHash) return known.blurHash
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
