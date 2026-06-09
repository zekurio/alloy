import type { ClipGameRef, GameRow } from "alloy-contracts"
import { game } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { eq } from "drizzle-orm"

import { db } from "../db"
import { nullableIsoDate } from "../runtime/date"
import { gameSlugWithId } from "./slug"
import { getGameAssets, getGameById } from "./steamgriddb"

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
    slug: gameSlugWithId(resolvedName, steamgriddbId),
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
    slug: row.slug,
    releaseDate: nullableIsoDate(row.releaseDate),
    heroUrl: row.heroUrl,
    heroBlurHash: row.heroBlurHash,
    gridUrl: row.gridUrl,
    gridBlurHash: row.gridBlurHash,
    logoUrl: row.logoUrl,
    iconUrl: row.iconUrl,
  }
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

async function loadSteamGridGameRef(
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

  const values = {
    steamgriddbId: detail.id,
    name: detail.name,
    slug: gameSlugWithId(detail.name, detail.id),
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

function loadSteamGridGameRefOnce(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const pending = pendingGameLoads.get(steamgriddbId)
  if (pending) return pending

  const load = loadSteamGridGameRef(steamgriddbId).finally(() => {
    pendingGameLoads.delete(steamgriddbId)
  })
  pendingGameLoads.set(steamgriddbId, load)
  return load
}

function refreshCachedGameRef(steamgriddbId: number): void {
  void loadSteamGridGameRefOnce(steamgriddbId).catch((err) => {
    logger.warn(`[steamgriddb] failed to refresh game ${steamgriddbId}:`, err)
  })
}

export async function getSteamGridGameRef(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const cached = await selectCachedGameRef(steamgriddbId)
  if (cached) {
    if (shouldRefresh(cached)) refreshCachedGameRef(steamgriddbId)
    return serialiseGameRow(cached)
  }

  return loadSteamGridGameRefOnce(steamgriddbId)
}

export async function getSteamGridGameRefOrSnapshot(input: {
  steamgriddbId: number
  name: string | null
}): Promise<GameRow> {
  try {
    const row = await getSteamGridGameRef(input.steamgriddbId)
    if (row) return row
  } catch (err) {
    logger.warn(
      `[steamgriddb] using cached game snapshot for ${input.steamgriddbId}:`,
      err,
    )
  }
  return gameRowFromSnapshot(input.steamgriddbId, input.name)
}
