import {
  type ClipGameRef,
  type GameRow,
  type SteamGridDBGameDetail,
} from "@alloy/contracts"
import { game } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import {
  POSTGRES_UNIQUE_VIOLATION,
  postgresErrorHasCode,
} from "@alloy/server/db/postgres-error"
import { and, eq, inArray, like, or } from "drizzle-orm"

import {
  gameSelection,
  type GameMetadataRow,
  serialiseGameRow,
} from "./game-row"
import { gameSlug } from "./slug"
import {
  artworkFailed,
  artworkUrl,
  type GameArtwork,
  getGameArtwork,
  getGameById,
} from "./steamgriddb"

const logger = createLogger("steamgriddb")

const GAME_REF_REFRESH_MS = 7 * 24 * 60 * 60 * 1000
// Failed refreshes back off exponentially from one hour to the regular
// refresh interval. A game SteamGridDB no longer knows ends up costing one
// round-trip a week instead of one per read. A snapshot with a failed asset
// listing counts as a failure too, so missing artwork is retried within the
// hour but an endpoint that keeps failing is not retried hourly forever.
const REFRESH_FAILURE_BACKOFF_MS = 60 * 60 * 1000
const REFRESH_FAILURE_BACKOFF_MAX_MS = GAME_REF_REFRESH_MS
// Background refreshes beyond this many are skipped, not queued: a search
// that lists many stale games must not start a refresh for each. A skipped
// game is still due and refreshes on a later read.
const MAX_BACKGROUND_REFRESHES = 4
const SLUG_INSERT_ATTEMPTS = 3

export { gameSelection, serialiseGameRow } from "./game-row"
export {
  type IndexedGameNameLookupCandidate,
  lookupIndexedGamesByName,
} from "./indexed-name-lookup"

type CachedGameMetadataRow = GameMetadataRow & {
  updatedAt: Date | string
  refreshAfter: Date | string | null
  refreshFailures: number
}

const cachedGameSelection = {
  ...gameSelection,
  updatedAt: game.updated_at,
  refreshAfter: game.refresh_after,
  refreshFailures: game.refresh_failures,
} as const

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

  return randomGameSlug(base)
}

function randomGameSlug(base: string): string {
  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Runs a write that needs a free slug for `name`. Two concurrent writers can
 * compute the same free slug; the loser hits the unique index and retries
 * with a new one, falling back to a random suffix on the last attempt.
 */
async function withAvailableGameSlug<T>(
  name: string,
  exclude: { gameId?: string | null; steamgriddbId?: number | null },
  write: (slug: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const slug =
      attempt < SLUG_INSERT_ATTEMPTS
        ? await availableGameSlug(name, exclude)
        : randomGameSlug(gameSlug(name))
    try {
      return await write(slug)
    } catch (err) {
      if (
        attempt >= SLUG_INSERT_ATTEMPTS ||
        !postgresErrorHasCode(err, POSTGRES_UNIQUE_VIOLATION)
      ) {
        throw err
      }
    }
  }
}

function refreshDue(row: CachedGameMetadataRow): boolean {
  const after =
    row.refreshAfter !== null
      ? new Date(row.refreshAfter).getTime()
      : new Date(row.updatedAt).getTime() + GAME_REF_REFRESH_MS
  return Date.now() >= after
}

function refreshFailureBackoffMs(failures: number): number {
  const exponent = Math.min(Math.max(failures - 1, 0), 30)
  return Math.min(
    REFRESH_FAILURE_BACKOFF_MS * 2 ** exponent,
    REFRESH_FAILURE_BACKOFF_MAX_MS,
  )
}

function maybeRefreshInBackground(row: CachedGameMetadataRow): void {
  if (
    row.source === "steamgriddb" &&
    row.steamgriddbId !== null &&
    refreshDue(row)
  ) {
    refreshCachedGameRef(row.id, row.steamgriddbId)
  }
}

async function selectCachedGameRef(
  steamgriddbId: number,
): Promise<CachedGameMetadataRow | null> {
  const [row] = await db
    .select(cachedGameSelection)
    .from(game)
    .where(eq(game.steamgriddb_id, steamgriddbId))
    .limit(1)
  return row ?? null
}

async function selectCachedGameRefById(
  gameId: string,
): Promise<CachedGameMetadataRow | null> {
  const [row] = await db
    .select(cachedGameSelection)
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
    .select(cachedGameSelection)
    .from(game)
    .where(inArray(game.id, gameIds))
}

async function selectCachedGameRefBySlug(
  slug: string,
): Promise<CachedGameMetadataRow | null> {
  const [row] = await db
    .select(cachedGameSelection)
    .from(game)
    .where(eq(game.slug, slug))
    .limit(1)
  return row ?? null
}

type SteamGridDBSnapshot = {
  detail: SteamGridDBGameDetail
  artwork: GameArtwork
}

// The detail lookup goes first: an id SteamGridDB does not know costs one
// request, not five.
async function fetchSteamGridDBSnapshot(
  steamgriddbId: number,
  previous: CachedGameMetadataRow | null,
): Promise<SteamGridDBSnapshot | null> {
  const detail = await getGameById(steamgriddbId)
  if (!detail) return null
  return { detail, artwork: await getGameArtwork(steamgriddbId, previous) }
}

function steamGridDBGameColumns(input: {
  snapshot: SteamGridDBSnapshot
  slug: string
  previous: CachedGameMetadataRow | null
}): typeof game.$inferInsert {
  const { detail, artwork } = input.snapshot
  const previous = input.previous
  // A failed listing keeps the stored artwork; only "SteamGridDB lists
  // nothing" clears it.
  const heroUrl =
    artwork.hero.kind === "failed"
      ? (previous?.heroUrl ?? null)
      : artworkUrl(artwork.hero)
  const gridUrl =
    artwork.grid.kind === "failed"
      ? (previous?.gridUrl ?? null)
      : artworkUrl(artwork.grid)
  const logoUrl =
    artwork.logo.kind === "failed"
      ? (previous?.logoUrl ?? null)
      : artworkUrl(artwork.logo)
  const iconUrl =
    artwork.icon.kind === "failed"
      ? (previous?.iconUrl ?? null)
      : artworkUrl(artwork.icon)
  const failures = artworkFailed(artwork)
    ? (previous?.refreshFailures ?? 0) + 1
    : 0
  const now = Date.now()
  return {
    steamgriddb_id: detail.id,
    source: "steamgriddb",
    name: detail.name,
    slug: input.slug,
    release_date:
      detail.release_date != null ? new Date(detail.release_date * 1000) : null,
    hero_url: heroUrl,
    hero_blur_hash:
      heroUrl === previous?.heroUrl
        ? (artwork.heroBlurHash ?? previous.heroBlurHash)
        : artwork.heroBlurHash,
    grid_url: gridUrl,
    grid_blur_hash:
      gridUrl === previous?.gridUrl
        ? (artwork.gridBlurHash ?? previous.gridBlurHash)
        : artwork.gridBlurHash,
    logo_url: logoUrl,
    icon_url: iconUrl,
    updated_at: new Date(now),
    refresh_after: new Date(
      now +
        (failures > 0
          ? refreshFailureBackoffMs(failures)
          : GAME_REF_REFRESH_MS),
    ),
    refresh_failures: failures,
  }
}

async function insertSteamGridDBGameRef(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const snapshot = await fetchSteamGridDBSnapshot(steamgriddbId, null)
  if (!snapshot) return null

  const row = await withAvailableGameSlug(
    snapshot.detail.name,
    { steamgriddbId },
    async (slug) => {
      const [inserted] = await db
        .insert(game)
        .values(steamGridDBGameColumns({ snapshot, slug, previous: null }))
        .onConflictDoNothing({ target: game.steamgriddb_id })
        .returning(gameSelection)
      return inserted ?? null
    },
  )
  if (row) return serialiseGameRow(row)

  const existing = await selectCachedGameRef(steamgriddbId)
  return existing ? serialiseGameRow(existing) : null
}

async function recordRefreshFailure(
  gameId: string,
  previousFailures: number,
  cause: string,
): Promise<void> {
  const failures = previousFailures + 1
  const backoffMs = refreshFailureBackoffMs(failures)
  logger.warn(
    `game ${gameId} refresh failed (${cause}); next attempt in ${Math.round(
      backoffMs / 60_000,
    )} min`,
  )
  await db
    .update(game)
    .set({
      refresh_failures: failures,
      refresh_after: new Date(Date.now() + backoffMs),
    })
    .where(and(eq(game.id, gameId), eq(game.source, "steamgriddb")))
}

// Refresh only the original row. An in-flight fetch must neither recreate a
// deleted game nor overwrite a row that an admin has customized. Failures
// stamp a backoff on the row so the next read does not try again at once.
async function updateSteamGridDBGameRef(
  gameId: string,
  steamgriddbId: number,
): Promise<void> {
  const previous = await selectCachedGameRefById(gameId)
  if (!previous || previous.source !== "steamgriddb") return

  let snapshot: SteamGridDBSnapshot | null
  try {
    snapshot = await fetchSteamGridDBSnapshot(steamgriddbId, previous)
  } catch (err) {
    await recordRefreshFailure(
      gameId,
      previous.refreshFailures,
      err instanceof Error ? err.message : "unknown error",
    )
    return
  }
  if (!snapshot) {
    await recordRefreshFailure(
      gameId,
      previous.refreshFailures,
      "SteamGridDB no longer lists this game",
    )
    return
  }

  await withAvailableGameSlug(
    snapshot.detail.name,
    { gameId, steamgriddbId: snapshot.detail.id },
    (slug) =>
      db
        .update(game)
        .set(steamGridDBGameColumns({ snapshot, slug, previous }))
        .where(and(eq(game.id, gameId), eq(game.source, "steamgriddb"))),
  )
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

const pendingGameRefreshes = new Map<string, Promise<void>>()

function refreshCachedGameRef(gameId: string, steamgriddbId: number): void {
  if (
    pendingGameRefreshes.has(gameId) ||
    pendingGameRefreshes.size >= MAX_BACKGROUND_REFRESHES
  ) {
    return
  }
  const refresh = updateSteamGridDBGameRef(gameId, steamgriddbId).finally(
    () => {
      pendingGameRefreshes.delete(gameId)
    },
  )
  pendingGameRefreshes.set(gameId, refresh)
  void refresh.catch((err) => {
    logger.warn(`failed to refresh game ${gameId}:`, err)
  })
}

/**
 * The catalogue row for a SteamGridDB game, created from upstream when it is
 * missing. This is the write path behind picking a game or matching a
 * library name; read routes use `findSteamGridDBGameRef` instead.
 */
export async function getSteamGridDBGameRef(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const cached = await selectCachedGameRef(steamgriddbId)
  if (cached) {
    maybeRefreshInBackground(cached)
    return serialiseGameRow(cached)
  }

  return insertSteamGridDBGameRefOnce(steamgriddbId)
}

/** An existing catalogue row by SteamGridDB id; never creates one. */
export async function findSteamGridDBGameRef(
  steamgriddbId: number,
): Promise<GameRow | null> {
  const cached = await selectCachedGameRef(steamgriddbId)
  if (!cached) return null
  maybeRefreshInBackground(cached)
  return serialiseGameRow(cached)
}

/**
 * Resolve a game by its surrogate id — the write path for attaching a game
 * (SteamGridDB or custom) to a clip. SteamGridDB rows are refreshed on a TTL
 * in the background; custom rows are returned as-is.
 */
export async function getGameRefById(gameId: string): Promise<GameRow | null> {
  const cached = await selectCachedGameRefById(gameId)
  if (!cached) return null
  maybeRefreshInBackground(cached)
  return serialiseGameRow(cached)
}

export async function getGameRefsByIds(
  gameIds: string[],
): Promise<Map<string, GameRow>> {
  const rows = await selectCachedGameRefsByIds(gameIds)
  const refs = new Map<string, GameRow>()
  for (const row of rows) {
    maybeRefreshInBackground(row)
    refs.set(row.id, serialiseGameRow(row))
  }
  return refs
}

export async function getSteamGridDBGameRefBySlug(
  slug: string,
): Promise<GameRow | null> {
  const cached = await selectCachedGameRefBySlug(slug)
  if (!cached) return null
  maybeRefreshInBackground(cached)
  return serialiseGameRow(cached)
}
