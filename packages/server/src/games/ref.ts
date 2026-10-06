import {
  type ClipGameRef,
  type GameRow,
  type SteamGridDBGameDetail,
} from "@alloy/contracts"
import { game } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { and, eq, inArray, like, or } from "drizzle-orm"

import {
  gameSelection,
  type GameMetadataRow,
  serialiseGameRow,
} from "./game-row"
import { gameSlug } from "./slug"
import { getGameAssets, getGameById } from "./steamgriddb"

const logger = createLogger("steamgriddb")

const GAME_REF_REFRESH_MS = 7 * 24 * 60 * 60 * 1000

export { gameSelection, serialiseGameRow } from "./game-row"
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

function gameRowFromSnapshot(input: {
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

/** Human label for a clip's game, covering the uncategorised snapshot case. */
export function clipGameName(row: {
  gameId: string | null
  game: string | null
}): string {
  if (row.gameId === null) return row.game?.trim() || "Uncategorised"
  return clipGameRefFromSnapshot({ id: row.gameId, name: row.game }).name
}

export async function availableGameSlug(
  name: string,
  exclude: { gameId?: string | null; steamgriddbId?: number | null } = {},
): Promise<string> {
  const base = gameSlug(name)
  const rows = await db
    .select({
      id: game.id,
      steamgriddbId: game.steamgriddb_id,
      slug: game.slug,
    })
    .from(game)
    .where(or(eq(game.slug, base), like(game.slug, `${base}-%`)))

  const reserved = new Set(
    rows
      .filter(
        (row) =>
          row.id !== exclude.gameId &&
          (exclude.steamgriddbId == null ||
            row.steamgriddbId !== exclude.steamgriddbId),
      )
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
    .select({ ...gameSelection, updatedAt: game.updated_at })
    .from(game)
    .where(eq(game.steamgriddb_id, steamgriddbId))
    .limit(1)
  return row ?? null
}

async function selectCachedGameRefById(
  gameId: string,
): Promise<CachedGameMetadataRow | null> {
  const [row] = await db
    .select({ ...gameSelection, updatedAt: game.updated_at })
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
    .select({ ...gameSelection, updatedAt: game.updated_at })
    .from(game)
    .where(inArray(game.id, gameIds))
}

async function selectCachedGameRefBySlug(
  slug: string,
): Promise<CachedGameMetadataRow | null> {
  const [row] = await db
    .select({ ...gameSelection, updatedAt: game.updated_at })
    .from(game)
    .where(eq(game.slug, slug))
    .limit(1)
  return row ?? null
}

type SteamGridDBSnapshot = {
  detail: SteamGridDBGameDetail
  assets: Awaited<ReturnType<typeof getGameAssets>>
}

async function fetchSteamGridDBSnapshot(
  steamgriddbId: number,
): Promise<SteamGridDBSnapshot | null> {
  const [detail, assets] = await Promise.all([
    getGameById(steamgriddbId),
    getGameAssets(steamgriddbId),
  ])
  return detail ? { detail, assets } : null
}

function steamGridDBGameColumns(input: {
  snapshot: SteamGridDBSnapshot
  slug: string
  previous: CachedGameMetadataRow | null
}): typeof game.$inferInsert {
  const { detail, assets } = input.snapshot
  return {
    steamgriddb_id: detail.id,
    source: "steamgriddb",
    name: detail.name,
    slug: input.slug,
    release_date:
      detail.release_date != null ? new Date(detail.release_date * 1000) : null,
    hero_url: assets.heroUrl,
    hero_blur_hash:
      assets.heroUrl === input.previous?.heroUrl
        ? (assets.heroBlurHash ?? input.previous.heroBlurHash)
        : assets.heroBlurHash,
    grid_url: assets.gridUrl,
    grid_blur_hash:
      assets.gridUrl === input.previous?.gridUrl
        ? (assets.gridBlurHash ?? input.previous.gridBlurHash)
        : assets.gridBlurHash,
    logo_url: assets.logoUrl,
    icon_url: assets.iconUrl,
    updated_at: new Date(),
  }
}

async function insertSteamGridDBGameRef(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const snapshot = await fetchSteamGridDBSnapshot(steamgriddbId)
  if (!snapshot) return null
  const slug = await availableGameSlug(snapshot.detail.name, { steamgriddbId })

  const [row] = await db
    .insert(game)
    .values(steamGridDBGameColumns({ snapshot, slug, previous: null }))
    .onConflictDoNothing({ target: game.steamgriddb_id })
    .returning(gameSelection)
  if (row) return serialiseGameRow(row)

  const existing = await selectCachedGameRef(steamgriddbId)
  return existing ? serialiseGameRow(existing) : null
}

// Refresh only the original row. An in-flight fetch must neither recreate a
// deleted game nor overwrite a row that an admin has customized.
async function updateSteamGridDBGameRef(
  gameId: string,
  steamgriddbId: number,
): Promise<GameRow | null> {
  const [previous, snapshot] = await Promise.all([
    selectCachedGameRefById(gameId),
    fetchSteamGridDBSnapshot(steamgriddbId),
  ])
  if (!previous || !snapshot) return null
  const slug = await availableGameSlug(snapshot.detail.name, {
    gameId,
    steamgriddbId: snapshot.detail.id,
  })

  const [row] = await db
    .update(game)
    .set(steamGridDBGameColumns({ snapshot, slug, previous }))
    .where(and(eq(game.id, gameId), eq(game.source, "steamgriddb")))
    .returning(gameSelection)
  if (row) return serialiseGameRow(row)

  const current = await selectCachedGameRefById(gameId)
  return current ? serialiseGameRow(current) : null
}

function insertSteamGridDBGameRefOnce(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const pending = pendingGameLoads.get(steamgriddbId)
  if (pending) return pending

  const load = insertSteamGridDBGameRef(steamgriddbId).finally(() => {
    pendingGameLoads.delete(steamgriddbId)
  })
  pendingGameLoads.set(steamgriddbId, load)
  return load
}

const pendingGameRefreshes = new Map<string, Promise<GameRow | null>>()

function refreshCachedGameRef(gameId: string, steamgriddbId: number): void {
  const refresh =
    pendingGameRefreshes.get(gameId) ??
    updateSteamGridDBGameRef(gameId, steamgriddbId).finally(() => {
      pendingGameRefreshes.delete(gameId)
    })
  pendingGameRefreshes.set(gameId, refresh)
  void refresh.catch((err) => {
    logger.warn(`failed to refresh game ${gameId}:`, err)
  })
}

export async function getSteamGridDBGameRef(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const cached = await selectCachedGameRef(steamgriddbId)
  if (cached) {
    if (shouldBackgroundRefresh(cached) && cached.steamgriddbId !== null) {
      refreshCachedGameRef(cached.id, cached.steamgriddbId)
    }
    return serialiseGameRow(cached)
  }

  return insertSteamGridDBGameRefOnce(steamgriddbId)
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
    refreshCachedGameRef(cached.id, cached.steamgriddbId)
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
      refreshCachedGameRef(row.id, row.steamgriddbId)
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
      refreshCachedGameRef(cached.id, cached.steamgriddbId)
    }
    return serialiseGameRow(cached)
  }

  return null
}
