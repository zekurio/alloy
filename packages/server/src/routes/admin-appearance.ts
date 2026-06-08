import { Buffer } from "node:buffer"

import { type LoginSplashConfig } from "alloy-contracts"
import { user } from "alloy-db/auth-schema"
import { clip } from "alloy-db/schema"
import { logger } from "alloy-logging"
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"

import { configStore } from "../config/store"
import { db } from "../db"
import { parseImageBytes, validateImageBytes } from "../media/image-validation"
import { runImageMagick } from "../media/imagemagick"
import { clipStorage, dataStorage } from "../storage"
import { readAll } from "./clips-helpers"

const LOGIN_SPLASH_CLIP_LIMIT = 24
const SPLASH_CONTENT_TYPE = "image/webp"
const SPLASH_WEBP_QUALITY = 82
const SPLASH_WIDTH = 1920
const SPLASH_HEIGHT = 1080
const MAX_SPLASH_TILES = 24
const TILE_WIDTH = 540
const TILE_HEIGHT = 304
const TILE_GAP = 24
const TILE_ROTATION_DEGREES = 8
const TILE_GRID_MARGIN_STEPS = 2
const TILE_ROW_SHIFT = 184
const TILE_ROW_SHIFTS = [0, 0.58, 0.22, 0.74, 0.39] as const

export const LOGIN_SPLASH_STORAGE_KEY = "splash/splashscreen.webp"

export const LOGIN_SPLASH_CONTENT_TYPE = SPLASH_CONTENT_TYPE

export type SplashClipRow = {
  id: string
  title: string
  game: string | null
  thumbKey: string
}

type SplashClipAsset = SplashClipRow & {
  bytes: Uint8Array
}

type SplashTile = {
  dataUri: string
}

async function selectRandomPublicSplashClipIds(): Promise<string[]> {
  const rows = await db
    .select({ id: clip.id })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .where(
      and(
        eq(clip.status, "ready"),
        eq(clip.privacy, "public"),
        isNotNull(clip.thumbKey),
        isNull(user.disabledAt),
      ),
    )
    .orderBy(sql`random()`)
    .limit(LOGIN_SPLASH_CLIP_LIMIT)
  return rows.map((row) => row.id)
}

async function buildTileOrNull(
  asset: SplashClipAsset,
): Promise<SplashTile | null> {
  try {
    const bytes = Buffer.from(asset.bytes)
    const metadata = parseImageBytes(bytes)
    if (!metadata) return null
    return {
      dataUri: `data:${metadata.contentType};base64,${bytes.toString("base64")}`,
    }
  } catch (err) {
    logger.warn(
      `[admin-appearance] failed to build login splash tile ${asset.id}:`,
      err,
    )
    return null
  }
}

async function renderSplashSvgToWebp(svg: string): Promise<Uint8Array> {
  return await runImageMagick(
    ["svg:-", "-quality", String(SPLASH_WEBP_QUALITY), "webp:-"],
    Buffer.from(svg),
  )
}

async function renderImageBytesToSplashWebp(
  bytes: Buffer,
): Promise<Uint8Array> {
  return await runImageMagick(
    [
      "-",
      "-auto-orient",
      "-resize",
      `${SPLASH_WIDTH}x${SPLASH_HEIGHT}^`,
      "-gravity",
      "center",
      "-extent",
      `${SPLASH_WIDTH}x${SPLASH_HEIGHT}`,
      "-quality",
      String(SPLASH_WEBP_QUALITY),
      "webp:-",
    ],
    bytes,
  )
}

function buildSplashSvg(tiles: SplashTile[]): string {
  const rotationRadians = (TILE_ROTATION_DEGREES * Math.PI) / 180
  const rotationCoverWidth =
    SPLASH_WIDTH * Math.abs(Math.cos(rotationRadians)) +
    SPLASH_HEIGHT * Math.abs(Math.sin(rotationRadians))
  const rotationCoverHeight =
    SPLASH_WIDTH * Math.abs(Math.sin(rotationRadians)) +
    SPLASH_HEIGHT * Math.abs(Math.cos(rotationRadians))
  const gridWidth = Math.ceil(
    rotationCoverWidth + (TILE_WIDTH + TILE_GAP) * TILE_GRID_MARGIN_STEPS,
  )
  const gridHeight = Math.ceil(
    rotationCoverHeight + (TILE_HEIGHT + TILE_GAP) * TILE_GRID_MARGIN_STEPS,
  )
  const columnCount =
    Math.ceil((gridWidth + TILE_GAP) / (TILE_WIDTH + TILE_GAP)) + 1
  const rowCount =
    Math.ceil((gridHeight + TILE_GAP) / (TILE_HEIGHT + TILE_GAP)) + 1
  const contentWidth = columnCount * TILE_WIDTH + (columnCount - 1) * TILE_GAP
  const contentHeight = rowCount * TILE_HEIGHT + (rowCount - 1) * TILE_GAP
  const startLeft = Math.floor((gridWidth - contentWidth) / 2)
  const startTop = Math.floor((gridHeight - contentHeight) / 2)
  const gridLeft = Math.floor((SPLASH_WIDTH - gridWidth) / 2)
  const gridTop = Math.floor((SPLASH_HEIGHT - gridHeight) / 2)

  const images: string[] = []
  let tileIndex = 0
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const top = startTop + rowIndex * (TILE_HEIGHT + TILE_GAP)
    const rowShift =
      TILE_ROW_SHIFT * (TILE_ROW_SHIFTS[rowIndex % TILE_ROW_SHIFTS.length] ?? 0)
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const left = Math.round(
        startLeft + rowShift + columnIndex * (TILE_WIDTH + TILE_GAP),
      )
      const tile = tiles[tileIndex % tiles.length]
      if (!tile) continue
      images.push(
        `<image href="${tile.dataUri}" x="${left}" y="${top}" width="${TILE_WIDTH}" height="${TILE_HEIGHT}" preserveAspectRatio="xMidYMid slice"/>`,
      )
      tileIndex++
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPLASH_WIDTH}" height="${SPLASH_HEIGHT}" viewBox="0 0 ${SPLASH_WIDTH} ${SPLASH_HEIGHT}">
  <defs>
    <radialGradient id="vignette" cx="50%" cy="48%" r="74%">
      <stop offset="38%" stop-color="#050609" stop-opacity="0"/>
      <stop offset="100%" stop-color="#050609" stop-opacity="0.46"/>
    </radialGradient>
    <linearGradient id="rightShade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="52%" stop-color="#050609" stop-opacity="0"/>
      <stop offset="100%" stop-color="#050609" stop-opacity="0.42"/>
    </linearGradient>
    <linearGradient id="bottomShade" x1="0" x2="0" y1="0" y2="1">
      <stop offset="58%" stop-color="#050609" stop-opacity="0"/>
      <stop offset="100%" stop-color="#050609" stop-opacity="0.36"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="#050609"/>
  <g transform="translate(${gridLeft} ${gridTop}) rotate(${TILE_ROTATION_DEGREES} ${gridWidth / 2} ${gridHeight / 2})">
    ${images.join("\n    ")}
  </g>
  <rect width="100%" height="100%" fill="#050609" opacity="0.22"/>
  <rect width="100%" height="100%" fill="url(#vignette)"/>
  <rect width="100%" height="100%" fill="url(#rightShade)"/>
  <rect width="100%" height="100%" fill="url(#bottomShade)"/>
</svg>`
}

async function buildLoginSplashImage(
  assets: SplashClipAsset[],
): Promise<Uint8Array | null> {
  const tiles = await Promise.all(assets.map(buildTileOrNull))
  const usableTiles = tiles.filter((tile): tile is SplashTile => tile !== null)
  if (usableTiles.length === 0) return null

  return await renderSplashSvgToWebp(buildSplashSvg(usableTiles))
}

async function buildUploadedLoginSplashImage(
  bytes: Buffer,
): Promise<Uint8Array> {
  return await renderImageBytesToSplashWebp(bytes)
}

async function selectLoginSplashAssets(
  rows: SplashClipRow[],
): Promise<SplashClipAsset[]> {
  const assets: SplashClipAsset[] = []
  for (const row of rows.slice(0, MAX_SPLASH_TILES)) {
    const resolved = await clipStorage.resolve(row.thumbKey)
    if (!resolved) continue
    const bytes = await readAll(resolved.stream())
    assets.push({ ...row, bytes })
  }
  return assets
}

export async function selectLoginSplashRows(
  clipIds: string[],
): Promise<SplashClipRow[]> {
  if (clipIds.length === 0) return []

  const rows = await db
    .select({
      id: clip.id,
      title: clip.title,
      game: clip.game,
      thumbKey: clip.thumbKey,
    })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .where(
      and(
        inArray(clip.id, clipIds),
        eq(clip.status, "ready"),
        eq(clip.privacy, "public"),
        isNotNull(clip.thumbKey),
        isNull(user.disabledAt),
      ),
    )

  const byId = new Map(rows.map((row) => [row.id, row]))
  return clipIds.flatMap((id) => {
    const row = byId.get(id)
    return row?.thumbKey ? [{ ...row, thumbKey: row.thumbKey }] : []
  })
}

export async function storeLoginSplashImage(
  rows: SplashClipRow[],
): Promise<boolean> {
  if (rows.length === 0) {
    await dataStorage.delete(LOGIN_SPLASH_STORAGE_KEY)
    return false
  }

  const assets = await selectLoginSplashAssets(rows)
  const image = await buildLoginSplashImage(assets)
  if (!image) {
    await dataStorage.delete(LOGIN_SPLASH_STORAGE_KEY)
    return false
  }

  await dataStorage.put(LOGIN_SPLASH_STORAGE_KEY, image, SPLASH_CONTENT_TYPE)
  return true
}

export async function storeUploadedLoginSplashImage(input: {
  bytes: Uint8Array
  contentType: string
}): Promise<void> {
  const bytes = Buffer.from(input.bytes)
  const validation = validateImageBytes(bytes, input.contentType)
  if (!validation.ok) {
    throw new Error(validation.error)
  }

  const image = await buildUploadedLoginSplashImage(bytes)
  await dataStorage.put(LOGIN_SPLASH_STORAGE_KEY, image, SPLASH_CONTENT_TYPE)
}

export async function generateLoginSplashPatch(
  enabled = true,
  treatment: Pick<LoginSplashConfig, "blurPx" | "darkenOpacity"> = {
    blurPx: 24,
    darkenOpacity: 0.8,
  },
): Promise<LoginSplashConfig> {
  const clipIds = await selectRandomPublicSplashClipIds()
  await storeLoginSplashImage(await selectLoginSplashRows(clipIds))

  return {
    enabled,
    ...treatment,
  }
}

/**
 * Heals the persisted login splash image when the config says it is enabled but
 * no image exists in the data store. This covers fresh installs, upgrades that
 * relocated the splash (it is regenerated in the new spot rather than migrated),
 * format changes, and storage loss. Safe to call at startup; it is a no-op when
 * the splash is disabled or the image is already present.
 */
export async function ensureLoginSplashImage(): Promise<void> {
  const loginSplash = configStore.get("appearance").loginSplash
  if (!loginSplash.enabled) return
  if (await dataStorage.resolve(LOGIN_SPLASH_STORAGE_KEY)) return

  logger.info(
    "[admin-appearance] login splash enabled without a stored image; regenerating",
  )
  const clipIds = await selectRandomPublicSplashClipIds()
  await storeLoginSplashImage(await selectLoginSplashRows(clipIds))
}
