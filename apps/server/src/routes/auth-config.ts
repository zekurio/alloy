import { Hono } from "hono"
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { Image } from "@matmen/imagescript"

import {
  LOGIN_SPLASH_IMAGE_PATH,
  LOGIN_SPLASH_LAYOUT_VERSION,
  loginSplashImagePath,
  type PublicAuthConfig,
} from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"
import { logger } from "@workspace/logging"

import { db } from "../db"
import { env } from "../env"
import { configStore } from "../config/store"
import { getPublicProviders } from "../auth/oauth-config"
import { getSetupStatus } from "../auth/user-bootstrap"
import { notFound } from "../runtime/http-response"
import { storage } from "../storage"
import { readAll } from "./clips-helpers"

const LEGACY_SPLASH_IMAGE_PATH = "/login-splash.jpg"
const SPLASH_CONTENT_TYPE = "image/jpeg"
const SPLASH_WIDTH = 1920
const SPLASH_HEIGHT = 1080
const MAX_SPLASH_TILES = 24
const SPLASH_CACHE_MAX_BYTES = 8 * 1024 * 1024
const TILE_WIDTH = 540
const TILE_HEIGHT = 304
const TILE_GAP = 24
const TILE_ROTATION_DEGREES = 30
const TILE_GRID_MARGIN_STEPS = 2
const TILE_ROW_SHIFT = 184
const TILE_ROW_SHIFTS = [0, 0.58, 0.22, 0.74, 0.39] as const

type SplashClipRow = {
  id: string
  title: string
  game: string | null
  thumbKey: string
}

type SplashClipAsset = SplashClipRow & {
  bytes: Uint8Array
}

type SplashImage = InstanceType<typeof Image>

let splashCache: { key: string; image: Uint8Array } | null = null
let splashShadeCache: SplashImage | null = null

function imageBody(image: Uint8Array): ArrayBuffer {
  return image.buffer.slice(
    image.byteOffset,
    image.byteOffset + image.byteLength,
  ) as ArrayBuffer
}

function loginSplashCacheKey(rows: SplashClipRow[]): string {
  const generatedAt = configStore.get("appearance").loginSplash.generatedAt ??
    "pending"
  return `${LOGIN_SPLASH_LAYOUT_VERSION}:${generatedAt}:${
    rows
      .map((row) => `${row.id}:${row.thumbKey}`)
      .join(",")
  }`
}

function createSolidImage(width: number, height: number): SplashImage {
  return new Image(width, height).fill(Image.rgbToColor(5, 6, 9))
}

async function buildTile(asset: SplashClipAsset): Promise<SplashImage> {
  const image = await Image.decode(asset.bytes)
  return image.cover(TILE_WIDTH, TILE_HEIGHT)
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

async function buildTileOrNull(
  asset: SplashClipAsset,
): Promise<SplashImage | null> {
  try {
    return await buildTile(asset)
  } catch (err) {
    logger.warn(
      `[auth-config] failed to build login splash tile ${asset.id}:`,
      err,
    )
    return null
  }
}

async function selectLoginSplashRows(): Promise<SplashClipRow[]> {
  const loginSplash = configStore.get("appearance").loginSplash
  if (!loginSplash.enabled || loginSplash.clipIds.length === 0) return []

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
        inArray(clip.id, loginSplash.clipIds),
        eq(clip.status, "ready"),
        eq(clip.privacy, "public"),
        isNotNull(clip.thumbKey),
        isNull(user.disabledAt),
      ),
    )

  const byId = new Map(rows.map((row) => [row.id, row]))
  return loginSplash.clipIds.flatMap((id) => {
    const row = byId.get(id)
    return row?.thumbKey ? [{ ...row, thumbKey: row.thumbKey }] : []
  })
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

export const authConfigRoute = new Hono()
  .get("/", async (c) => {
    const setupStatus = await getSetupStatus()
    const loginSplash = configStore.get("appearance").loginSplash
    const splashRows = await selectLoginSplashRows()

    return c.json(
      {
        ...setupStatus,
        openRegistrations: configStore.get("openRegistrations"),
        passkeyEnabled: configStore.get("passkeyEnabled"),
        requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
        providers: getPublicProviders(),
        loginSplash: {
          enabled: loginSplash.enabled,
          generatedAt: loginSplash.generatedAt,
          imageUrl: loginSplash.enabled && splashRows.length > 0
            ? new URL(
              loginSplashImagePath(loginSplash.generatedAt),
              env.PUBLIC_SERVER_URL,
            ).toString()
            : null,
          clips: [],
        },
      } satisfies PublicAuthConfig,
    )
  })
  .get(LEGACY_SPLASH_IMAGE_PATH, (c) => {
    const url = new URL(c.req.url)
    url.pathname = LOGIN_SPLASH_IMAGE_PATH
    return c.redirect(url.toString(), 302)
  })
  .get(LOGIN_SPLASH_IMAGE_PATH.replace("/api/auth-config", ""), async (c) => {
    const rows = await selectLoginSplashRows()
    if (rows.length === 0) return notFound(c)

    const cacheKey = loginSplashCacheKey(rows)
    if (splashCache?.key === cacheKey) {
      c.header("Content-Type", SPLASH_CONTENT_TYPE)
      c.header("Content-Length", String(splashCache.image.byteLength))
      c.header("Cache-Control", "public, max-age=86400")
      return c.body(imageBody(splashCache.image))
    }

    const assets = await selectLoginSplashAssets(rows)
    if (assets.length === 0) return notFound(c)

    const image = await buildLoginSplashImage(assets)
    if (!image) return notFound(c)
    if (image.byteLength <= SPLASH_CACHE_MAX_BYTES) {
      splashCache = { key: cacheKey, image }
    }
    c.header("Content-Type", SPLASH_CONTENT_TYPE)
    c.header("Content-Length", String(image.byteLength))
    c.header("Cache-Control", "public, max-age=86400")
    return c.body(imageBody(image))
  })
