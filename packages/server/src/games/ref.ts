import type { ClipGameRef, GameRow } from "@alloy/contracts"
import { clip, clipView, game, gameFollow } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { nullableIsoDate } from "@alloy/server/runtime/date"
import { and, eq, ilike, inArray, like, or, type SQL, sql } from "drizzle-orm"

import { exactNameKey, normalizedNameKey } from "./name-match"
import {
  gameSlug,
  legacyGameSlug,
  steamgriddbIdFromLegacyGameSlug,
} from "./slug"
import { getGameAssets, getGameById } from "./steamgriddb"

const logger = createLogger("steamgriddb")

const GAME_REF_REFRESH_MS = 7 * 24 * 60 * 60 * 1000

export const gameSelectShape = {
  id: game.steamgriddbId,
  steamgriddbId: game.steamgriddbId,
  name: game.name,
  slug: game.slug,
  releaseDate: game.releaseDate,
  heroUrl: game.heroUrl,
  heroBlurHash: game.heroBlurHash,
  gridUrl: game.gridUrl,
  gridBlurHash: game.gridBlurHash,
  logoUrl: game.logoUrl,
  iconUrl: game.iconUrl,
} as const

type GameMetadataRow = {
  steamgriddbId: number
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

function snapshotName(steamgriddbId: number, name: string | null): string {
  const trimmed = name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : `Game ${steamgriddbId}`
}

export function gameRowFromSnapshot(
  steamgriddbId: number,
  name: string | null,
): GameRow {
  const resolvedName = snapshotName(steamgriddbId, name)
  return {
    id: steamgriddbId,
    steamgriddbId,
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
  steamgriddbId: number
  name: string | null
}): ClipGameRef {
  return gameRowFromSnapshot(input.steamgriddbId, input.name)
}

export function serialiseGameRow(row: GameMetadataRow): GameRow {
  return {
    id: row.steamgriddbId,
    steamgriddbId: row.steamgriddbId,
    name: row.name,
    slug: publicGameSlug(row),
    releaseDate: nullableIsoDate(row.releaseDate),
    heroUrl: row.heroUrl,
    heroBlurHash: row.heroBlurHash,
    gridUrl: row.gridUrl,
    gridBlurHash: row.gridBlurHash,
    logoUrl: row.logoUrl,
    iconUrl: row.iconUrl,
  }
}

function publicGameSlug(
  row: Pick<GameMetadataRow, "name" | "slug" | "steamgriddbId">,
): string {
  const clean = gameSlug(row.name)
  return row.slug === legacyGameSlug(row.name, row.steamgriddbId)
    ? clean
    : row.slug
}

async function availableGameSlug(
  name: string,
  steamgriddbId: number,
): Promise<string> {
  const base = gameSlug(name)
  const rows = await db
    .select({
      steamgriddbId: game.steamgriddbId,
      slug: game.slug,
    })
    .from(game)
    .where(
      or(
        eq(game.steamgriddbId, steamgriddbId),
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

  return legacyGameSlug(name, steamgriddbId)
}

function shouldRefresh(row: CachedGameMetadataRow): boolean {
  return Date.now() - new Date(row.updatedAt).getTime() > GAME_REF_REFRESH_MS
}

async function selectCachedGameRef(
  steamgriddbId: number,
): Promise<CachedGameMetadataRow | null> {
  const [row] = await db
    .select({ ...gameSelectShape, updatedAt: game.updatedAt })
    .from(game)
    .where(eq(game.steamgriddbId, steamgriddbId))
    .limit(1)
  return row ?? null
}

async function selectCachedGameRefBySlug(
  slug: string,
): Promise<CachedGameMetadataRow | null> {
  const [exact] = await db
    .select({ ...gameSelectShape, updatedAt: game.updatedAt })
    .from(game)
    .where(eq(game.slug, slug))
    .limit(1)
  if (exact) return exact

  const rows = await db
    .select({ ...gameSelectShape, updatedAt: game.updatedAt })
    .from(game)
    .where(like(game.slug, `${slug}-%`))
    .limit(25)
  const publicMatches = rows.filter((row) => publicGameSlug(row) === slug)
  return publicMatches.length === 1 ? publicMatches[0] : null
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
    steamgriddbId: detail.id,
    name: detail.name,
    slug,
    releaseDate,
    heroUrl: assets.heroUrl,
    heroBlurHash:
      assets.heroUrl === previous?.heroUrl
        ? (assets.heroBlurHash ?? previous.heroBlurHash)
        : assets.heroBlurHash,
    gridUrl: assets.gridUrl,
    gridBlurHash:
      assets.gridUrl === previous?.gridUrl
        ? (assets.gridBlurHash ?? previous.gridBlurHash)
        : assets.gridBlurHash,
    logoUrl: assets.logoUrl,
    iconUrl: assets.iconUrl,
    updatedAt: new Date(),
  }
  const updateValues = {
    name: values.name,
    slug: values.slug,
    releaseDate: values.releaseDate,
    heroUrl: values.heroUrl,
    heroBlurHash: values.heroBlurHash,
    gridUrl: values.gridUrl,
    gridBlurHash: values.gridBlurHash,
    logoUrl: values.logoUrl,
    iconUrl: values.iconUrl,
    updatedAt: values.updatedAt,
  }

  const [row] = await db
    .insert(game)
    .values(values)
    .onConflictDoUpdate({
      target: game.steamgriddbId,
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

export async function getSteamGridDBGameRefBySlug(
  slug: string,
): Promise<GameRow | null> {
  const cached = await selectCachedGameRefBySlug(slug)
  if (cached) {
    if (shouldRefresh(cached)) refreshCachedGameRef(cached.steamgriddbId)
    return serialiseGameRow(cached)
  }

  const legacySteamGridDBId = steamgriddbIdFromLegacyGameSlug(slug)
  if (!legacySteamGridDBId) return null

  const legacy = await getSteamGridDBGameRef(legacySteamGridDBId)
  if (!legacy) return null
  return legacyGameSlug(legacy.name, legacy.steamgriddbId) === slug
    ? legacy
    : null
}

export async function getSteamGridDBGameRefOrSnapshot(input: {
  steamgriddbId: number
  name: string | null
}): Promise<GameRow> {
  try {
    const row = await getSteamGridDBGameRef(input.steamgriddbId)
    if (row) return row
  } catch (err) {
    logger.warn(`using cached game snapshot for ${input.steamgriddbId}:`, err)
  }
  return gameRowFromSnapshot(input.steamgriddbId, input.name)
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
    ? sql<number>`count(distinct case when ${clip.authorId} = ${viewerId}::uuid then ${clip.id} end)::int`
    : sql<number>`0`
  const viewerViewCount = viewerId
    ? sql<number>`count(distinct ${clipView.clipId})::int`
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
    .leftJoin(clip, eq(clip.steamgriddbId, game.steamgriddbId))
    .leftJoin(
      clipView,
      and(
        eq(clipView.clipId, clip.id),
        viewerId ? sql`${clipView.userId} = ${viewerId}::uuid` : sql`false`,
      ),
    )
    .leftJoin(
      gameFollow,
      and(
        eq(gameFollow.steamgriddbId, game.steamgriddbId),
        viewerId ? sql`${gameFollow.userId} = ${viewerId}::uuid` : sql`false`,
      ),
    )
    .where(matchCondition)
    .groupBy(game.steamgriddbId)

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
