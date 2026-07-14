import { type ClipGameRef, type GameRow } from "@alloy/contracts"
import { game } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { eq, inArray, like, or } from "drizzle-orm"

import {
  gameSelectShape,
  type GameMetadataRow,
  serialiseGameRow,
} from "./game-row"
import { gameSlug } from "./slug"
import { getGameAssets, getGameById } from "./steamgriddb"

const logger = createLogger("steamgriddb")

const GAME_REF_REFRESH_MS = 7 * 24 * 60 * 60 * 1000

export { gameSelectShape, serialiseGameRow } from "./game-row"
export {
  type IndexedGameNameLookupCandidate,
  lookupIndexedGamesByName,
} from "./indexed-name-lookup"

type CachedGameMetadataRow = GameMetadataRow & {
  updatedAt: Date | string
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
