import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { Image } from "@matmen/imagescript"
import { Buffer } from "node:buffer"

import { type LoginSplashConfig } from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"
import { logger } from "@workspace/logging"

import { configStore } from "../config/store"
import { db } from "../db"
import { runImageMagick } from "../media/imagemagick"
import { validateImageBytes } from "../media/image-validation"
import { storage } from "../storage"
import { readAll } from "./clips-helpers"

const LOGIN_SPLASH_CLIP_LIMIT = 24
const SPLASH_CONTENT_TYPE = "image/jpeg"
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

export const LOGIN_SPLASH_STORAGE_KEY = "system/splashscreen.jpg"

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

type SplashImage = InstanceType<typeof Image>

let splashShadeCache: SplashImage | null = null

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

function createSolidImage(width: number, height: number): SplashImage {
  return new Image(width, height).fill(Image.rgbToColor(5, 6, 9))
}

async function decodeSplashSource(bytes: Uint8Array): Promise<SplashImage> {
  try {
    return await Image.decode(bytes)
  } catch (cause) {
    const png = await runImageMagick(["-", "png:-"], bytes)
    try {
      return await Image.decode(png)
    } catch {
      throw cause
    }
  }
}

async function buildTile(asset: SplashClipAsset): Promise<SplashImage> {
  const image = await decodeSplashSource(asset.bytes)
  return image.cover(TILE_WIDTH, TILE_HEIGHT)
}

async function buildTileOrNull(
  asset: SplashClipAsset,
): Promise<SplashImage | null> {
  try {
    return await buildTile(asset)
  } catch (err) {
    logger.warn(
      `[admin-appearance] failed to build login splash tile ${asset.id}:`,
      err,
    )
    return null
  }
}

function splashShadeOverlay(): SplashImage {
  if (splashShadeCache) return splashShadeCache

  const image = new Image(SPLASH_WIDTH, SPLASH_HEIGHT)
  const centerX = SPLASH_WIDTH * 0.5
  const centerY = SPLASH_HEIGHT * 0.48
  const maxDistance = Math.hypot(centerX, centerY)

  for (let y = 0; y < SPLASH_HEIGHT; y++) {
    for (let x = 0; x < SPLASH_WIDTH; x++) {
      const index = (y * SPLASH_WIDTH + x) * 4
      const distance = Math.hypot(x - centerX, y - centerY) / maxDistance
      const rightShade = Math.max(0, (x / SPLASH_WIDTH - 0.52) * 95)
      const bottomShade = Math.max(0, (y / SPLASH_HEIGHT - 0.58) * 70)
      const vignette = Math.min(120, distance * 88)
      image.bitmap[index + 3] = Math.round(
        56 + rightShade + bottomShade + vignette,
      )
    }
  }

  splashShadeCache = image
  return image
}

async function buildLoginSplashImage(
  assets: SplashClipAsset[],
): Promise<Uint8Array | null> {
  const tiles = await Promise.all(assets.map(buildTileOrNull))
  const usableTiles = tiles.filter((tile): tile is SplashImage => tile !== null)
  if (usableTiles.length === 0) return null

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

  const backdrop = createSolidImage(gridWidth, gridHeight)
  let tileIndex = 0
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const top = startTop + rowIndex * (TILE_HEIGHT + TILE_GAP)
    const rowShift = TILE_ROW_SHIFT *
      (TILE_ROW_SHIFTS[rowIndex % TILE_ROW_SHIFTS.length] ?? 0)
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const left = Math.round(
        startLeft + rowShift + columnIndex * (TILE_WIDTH + TILE_GAP),
      )
      const tile = usableTiles[tileIndex % usableTiles.length]
      if (!tile) continue
      backdrop.composite(tile, left, top)
      tileIndex++
    }
  }

  if (tileIndex === 0) return null

  backdrop.rotate(TILE_ROTATION_DEGREES)
  backdrop.crop(
    Math.floor((backdrop.width - SPLASH_WIDTH) / 2),
    Math.floor((backdrop.height - SPLASH_HEIGHT) / 2),
    SPLASH_WIDTH,
    SPLASH_HEIGHT,
  )

  return await createSolidImage(SPLASH_WIDTH, SPLASH_HEIGHT)
    .composite(backdrop, 0, 0)
    .composite(splashShadeOverlay(), 0, 0)
    .encodeJPEG(86)
}

async function buildUploadedLoginSplashImage(
  bytes: Buffer,
): Promise<Uint8Array> {
  const image = await decodeSplashSource(bytes)
  return await image.cover(SPLASH_WIDTH, SPLASH_HEIGHT).encodeJPEG(88)
}

async function selectLoginSplashAssets(
  rows: SplashClipRow[],
): Promise<SplashClipAsset[]> {
  const assets: SplashClipAsset[] = []
  for (const row of rows.slice(0, MAX_SPLASH_TILES)) {
    const resolved = await storage.resolve(row.thumbKey)
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
    await storage.delete(LOGIN_SPLASH_STORAGE_KEY)
    return false
  }

  const assets = await selectLoginSplashAssets(rows)
  const image = await buildLoginSplashImage(assets)
  if (!image) {
    await storage.delete(LOGIN_SPLASH_STORAGE_KEY)
    return false
  }

  await storage.put(LOGIN_SPLASH_STORAGE_KEY, image, SPLASH_CONTENT_TYPE)
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
  await storage.put(LOGIN_SPLASH_STORAGE_KEY, image, SPLASH_CONTENT_TYPE)
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
 * Heals the persisted login splash image when the config says it is enabled
 * but no image exists at the storage key. This covers upgrades from the
 * pre-v2 config (where the image was generated on demand and never persisted),
 * layout-version bumps, and storage loss. Safe to call at startup; it is a
 * no-op when the splash is disabled or the image is already present.
 */
export async function ensureLoginSplashImage(): Promise<void> {
  const loginSplash = configStore.get("appearance").loginSplash
  if (!loginSplash.enabled) return
  if (await storage.resolve(LOGIN_SPLASH_STORAGE_KEY)) return

  logger.info(
    "[admin-appearance] login splash enabled without a stored image; regenerating",
  )
  const clipIds = await selectRandomPublicSplashClipIds()
  await storeLoginSplashImage(await selectLoginSplashRows(clipIds))
}
