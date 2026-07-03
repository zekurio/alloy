import {
  normalizeBlurHash,
  type ClipGameRef,
  type GameRow,
  type GameSource,
} from "@alloy/contracts"
import { clip, clipView, game, gameFollow } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { nullableIsoDate } from "@alloy/server/runtime/date"
import { and, eq, ilike, inArray, like, or, type SQL, sql } from "drizzle-orm"

import { exactNameKey, normalizedNameKey } from "./name-match"
import { gameSlug } from "./slug"
import { getGameAssets, getGameById } from "./steamgriddb"

const logger = createLogger("steamgriddb")

const GAME_REF_REFRESH_MS = 7 * 24 * 60 * 60 * 1000

export const gameSelectShape = {
  id: game.id,
  steamgriddbId: game.steamgriddb_id,
  source: game.source,
  name: game.name,
  slug: game.slug,
  releaseDate: game.release_date,
  heroUrl: game.hero_url,
  heroBlurHash: game.hero_blur_hash,
  gridUrl: game.grid_url,
  gridBlurHash: game.grid_blur_hash,
  logoUrl: game.logo_url,
  iconUrl: game.icon_url,
} as const

type GameMetadataRow = {
  id: string
  steamgriddbId: number | null
  source: GameSource
  name: string
  slug: string
  releaseDate: Date | string | null
  heroUrl: string | null
  heroBlurHash: string | null
  gridUrl: string | null
  gridBlurHash: string | null
  logoUrl: string | null
  iconUrl: string | null
}

type CachedGameMetadataRow = GameMetadataRow & {
  updatedAt: Date | string
}

export type IndexedGameNameLookupCandidate = {
  game: GameRow
  exact: boolean
  normalized: boolean
  score: number
  personalScore: number
  clipCount: number
}

const pendingGameLoads = new Map<number, Promise<GameRow | null>>()

function snapshotName(name: string | null): string {
  const trimmed = name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : "Game"
}

export function gameRowFromSnapshot(input: {
  id: string
  name: string | null
}): GameRow {
  const resolvedName = snapshotName(input.name)
  return {
    id: input.id,
    steamgriddbId: null,
    source: "steamgriddb",
    name: resolvedName,
    slug: gameSlug(resolvedName),
    releaseDate: null,
    heroUrl: null,
    heroBlurHash: null,
    gridUrl: null,
    gridBlurHash: null,
    logoUrl: null,
    iconUrl: null,
  }
}

export function clipGameRefFromSnapshot(input: {
  id: string
  name: string | null
}): ClipGameRef {
  return gameRowFromSnapshot(input)
}

export function serialiseGameRow(row: GameMetadataRow): GameRow {
  return {
    id: row.id,
    steamgriddbId: row.steamgriddbId,
    source: row.source,
    name: row.name,
    slug: row.slug,
    releaseDate: nullableIsoDate(row.releaseDate),
    heroUrl: row.heroUrl,
    heroBlurHash: normalizeBlurHash(row.heroBlurHash),
    gridUrl: row.gridUrl,
    gridBlurHash: normalizeBlurHash(row.gridBlurHash),
    logoUrl: row.logoUrl,
    iconUrl: row.iconUrl,
  }
}

async function availableGameSlug(
  name: string,
  steamgriddbId: number,
): Promise<string> {
  const base = gameSlug(name)
  const rows = await db
    .select({
      steamgriddbId: game.steamgriddb_id,
      slug: game.slug,
    })
    .from(game)
    .where(
      or(
        eq(game.steamgriddb_id, steamgriddbId),
        eq(game.slug, base),
        like(game.slug, `${base}-%`),
      ),
    )

  const reserved = new Set(
    rows
      .filter((row) => row.steamgriddbId !== steamgriddbId)
      .map((row) => row.slug),
  )
  if (!reserved.has(base)) return base

  const firstVariant = `${base}-variant`
  if (!reserved.has(firstVariant)) return firstVariant

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-variant-${suffix}`
    if (!reserved.has(candidate)) return candidate
  }

  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Unique slug for an admin-authored custom game. Mirrors `availableGameSlug`
 * but excludes by surrogate id (custom games have no SteamGridDB id), so
 * editing a game keeps its own slug available.
 */
export async function availableCustomGameSlug(
  name: string,
  excludeGameId: string | null,
): Promise<string> {
  const base = gameSlug(name)
  const rows = await db
    .select({ id: game.id, slug: game.slug })
    .from(game)
    .where(or(eq(game.slug, base), like(game.slug, `${base}-%`)))

  const reserved = new Set(
    rows.filter((row) => row.id !== excludeGameId).map((row) => row.slug),
  )
  if (!reserved.has(base)) return base

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!reserved.has(candidate)) return candidate
  }

  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

function shouldRefresh(row: CachedGameMetadataRow): boolean {
  return Date.now() - new Date(row.updatedAt).getTime() > GAME_REF_REFRESH_MS
}

function shouldBackgroundRefresh(row: CachedGameMetadataRow): boolean {
  return (
    row.source === "steamgriddb" &&
    row.steamgriddbId !== null &&
    shouldRefresh(row)
  )
}

async function selectCachedGameRef(
  steamgriddbId: number,
): Promise<CachedGameMetadataRow | null> {
  const [row] = await db
    .select({ ...gameSelectShape, updatedAt: game.updated_at })
    .from(game)
    .where(eq(game.steamgriddb_id, steamgriddbId))
    .limit(1)
  return row ?? null
}

async function selectCachedGameRefById(
  gameId: string,
): Promise<CachedGameMetadataRow | null> {
  const [row] = await db
    .select({ ...gameSelectShape, updatedAt: game.updated_at })
    .from(game)
    .where(eq(game.id, gameId))
    .limit(1)
  return row ?? null
}

async function selectCachedGameRefsByIds(
  gameIds: string[],
): Promise<CachedGameMetadataRow[]> {
  if (gameIds.length === 0) return []
  return db
    .select({ ...gameSelectShape, updatedAt: game.updated_at })
    .from(game)
    .where(inArray(game.id, gameIds))
}

async function selectCachedGameRefBySlug(
  slug: string,
): Promise<CachedGameMetadataRow | null> {
  const [row] = await db
    .select({ ...gameSelectShape, updatedAt: game.updated_at })
    .from(game)
    .where(eq(game.slug, slug))
    .limit(1)
  return row ?? null
}

async function loadSteamGridDBGameRef(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const [previous, detail, assets] = await Promise.all([
    selectCachedGameRef(steamgriddbId),
    getGameById(steamgriddbId),
    getGameAssets(steamgriddbId),
  ])
  if (!detail) return null
  const releaseDate =
    detail.release_date != null ? new Date(detail.release_date * 1000) : null
  const slug = await availableGameSlug(detail.name, detail.id)

  const values = {
    steamgriddb_id: detail.id,
    source: "steamgriddb" as const,
    name: detail.name,
    slug,
    release_date: releaseDate,
    hero_url: assets.heroUrl,
    hero_blur_hash:
      assets.heroUrl === previous?.heroUrl
        ? (assets.heroBlurHash ?? previous.heroBlurHash)
        : assets.heroBlurHash,
    grid_url: assets.gridUrl,
    grid_blur_hash:
      assets.gridUrl === previous?.gridUrl
        ? (assets.gridBlurHash ?? previous.gridBlurHash)
        : assets.gridBlurHash,
    logo_url: assets.logoUrl,
    icon_url: assets.iconUrl,
    updated_at: new Date(),
  }
  const updateValues = {
    name: values.name,
    slug: values.slug,
    release_date: values.release_date,
    hero_url: values.hero_url,
    hero_blur_hash: values.hero_blur_hash,
    grid_url: values.grid_url,
    grid_blur_hash: values.grid_blur_hash,
    logo_url: values.logo_url,
    icon_url: values.icon_url,
    updated_at: values.updated_at,
  }

  const [row] = await db
    .insert(game)
    .values(values)
    .onConflictDoUpdate({
      target: game.steamgriddb_id,
      set: updateValues,
    })
    .returning(gameSelectShape)

  return row ? serialiseGameRow(row) : null
}

function loadSteamGridDBGameRefOnce(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const pending = pendingGameLoads.get(steamgriddbId)
  if (pending) return pending

  const load = loadSteamGridDBGameRef(steamgriddbId).finally(() => {
    pendingGameLoads.delete(steamgriddbId)
  })
  pendingGameLoads.set(steamgriddbId, load)
  return load
}

function refreshCachedGameRef(steamgriddbId: number): void {
  void loadSteamGridDBGameRefOnce(steamgriddbId).catch((err) => {
    logger.warn(`failed to refresh game ${steamgriddbId}:`, err)
  })
}

export async function getSteamGridDBGameRef(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const cached = await selectCachedGameRef(steamgriddbId)
  if (cached) {
    if (shouldRefresh(cached)) refreshCachedGameRef(steamgriddbId)
    return serialiseGameRow(cached)
  }

  return loadSteamGridDBGameRefOnce(steamgriddbId)
}

/**
 * Resolve a game by its surrogate id — the write path for attaching a game
 * (SteamGridDB or custom) to a clip. SteamGridDB rows are refreshed on a TTL
 * in the background; custom rows are returned as-is.
 */
export async function getGameRefById(gameId: string): Promise<GameRow | null> {
  const cached = await selectCachedGameRefById(gameId)
  if (!cached) return null
  if (shouldBackgroundRefresh(cached) && cached.steamgriddbId !== null) {
    refreshCachedGameRef(cached.steamgriddbId)
  }
  return serialiseGameRow(cached)
}

export async function getGameRefsByIds(
  gameIds: string[],
): Promise<Map<string, GameRow>> {
  const rows = await selectCachedGameRefsByIds(gameIds)
  const refs = new Map<string, GameRow>()
  for (const row of rows) {
    if (shouldBackgroundRefresh(row) && row.steamgriddbId !== null) {
      refreshCachedGameRef(row.steamgriddbId)
    }
    refs.set(row.id, serialiseGameRow(row))
  }
  return refs
}

export async function getSteamGridDBGameRefBySlug(
  slug: string,
): Promise<GameRow | null> {
  const cached = await selectCachedGameRefBySlug(slug)
  if (cached) {
    if (shouldBackgroundRefresh(cached) && cached.steamgriddbId !== null) {
      refreshCachedGameRef(cached.steamgriddbId)
    }
    return serialiseGameRow(cached)
  }

  return null
}

export async function lookupIndexedGamesByName(
  names: string[],
  viewerId: string | null,
): Promise<Map<string, IndexedGameNameLookupCandidate[]>> {
  const queries = uniqueLookupQueries(names)
  const matches = new Map<string, IndexedGameNameLookupCandidate[]>()
  for (const name of queries) matches.set(exactNameKey(name), [])
  if (queries.length === 0) return matches

  const matchCondition = indexedGameMatchCondition(queries)
  if (!matchCondition) return matches

  const viewerClipCount = viewerId
    ? sql<number>`count(distinct case when ${clip.author_id} = ${viewerId}::uuid then ${clip.id} end)::int`
    : sql<number>`0`
  const viewerViewCount = viewerId
    ? sql<number>`count(distinct ${clipView.clip_id})::int`
    : sql<number>`0`
  const followed = viewerId
    ? sql<number>`max(case when ${gameFollow.id} is null then 0 else 1 end)::int`
    : sql<number>`0`

  const rows = await db
    .select({
      ...gameSelectShape,
      clipNames: sql<
        string[]
      >`coalesce(array_remove(array_agg(distinct ${clip.game}), null), ARRAY[]::text[])`,
      clipCount: sql<number>`count(distinct ${clip.id})::int`,
      viewerClipCount,
      viewerViewCount,
      followed,
    })
    .from(game)
    .leftJoin(clip, eq(clip.game_id, game.id))
    .leftJoin(
      clipView,
      and(
        eq(clipView.clip_id, clip.id),
        viewerId ? sql`${clipView.user_id} = ${viewerId}::uuid` : sql`false`,
      ),
    )
    .leftJoin(
      gameFollow,
      and(
        eq(gameFollow.game_id, game.id),
        viewerId ? sql`${gameFollow.user_id} = ${viewerId}::uuid` : sql`false`,
      ),
    )
    .where(matchCondition)
    .groupBy(game.id)

  for (const row of rows) {
    const gameRow = serialiseGameRow(row)
    const searchableNames = [gameRow.name, ...row.clipNames.filter(Boolean)]
    const personalScore =
      Number(row.followed) * 1_000 +
      Number(row.viewerClipCount) * 100 +
      Number(row.viewerViewCount) * 10
    const score = personalScore + Number(row.clipCount)

    for (const name of queries) {
      const exact = searchableNames.some(
        (candidate) => exactNameKey(candidate) === exactNameKey(name),
      )
      const normalized = searchableNames.some(
        (candidate) => normalizedNameKey(candidate) === normalizedNameKey(name),
      )
      if (!exact && !normalized) continue

      matches.get(exactNameKey(name))?.push({
        game: gameRow,
        exact,
        normalized,
        score,
        personalScore,
        clipCount: Number(row.clipCount),
      })
    }
  }

  for (const candidates of matches.values()) {
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.game.name.localeCompare(b.game.name)
    })
  }

  return matches
}

function uniqueLookupQueries(names: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (!trimmed) continue
    const key = exactNameKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function indexedGameMatchCondition(names: string[]): SQL | undefined {
  const exactKeys = names.map(exactNameKey)
  const conditions: SQL[] = [
    inArray(sql<string>`lower(${game.name})`, exactKeys),
    inArray(sql<string>`lower(${clip.game})`, exactKeys),
  ]

  for (const name of names) {
    const pattern = `%${name}%`
    conditions.push(ilike(game.name, pattern), ilike(clip.game, pattern))
  }

  return or(...conditions)
}
