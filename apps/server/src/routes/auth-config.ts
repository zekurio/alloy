import { Hono } from "hono"
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import sharp from "sharp"

import {
  LOGIN_SPLASH_IMAGE_PATH,
  LOGIN_SPLASH_LAYOUT_VERSION,
  type PublicAuthConfig,
} from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { env } from "../env"
import { configStore } from "../config/store"
import { getPublicProvider } from "../auth/oauth-config"
import { getSetupStatus } from "../auth/user-bootstrap"
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

type SharpConstructorInput = Exclude<
  Parameters<typeof sharp>[0],
  undefined | unknown[]
>
type SharpOverlayInput = NonNullable<sharp.OverlayOptions["input"]>

let splashCache: { key: string; image: Uint8Array } | null = null
let splashShadeCache: Uint8Array | null = null

function imageBody(image: Uint8Array): ArrayBuffer {
  return image.buffer.slice(
    image.byteOffset,
    image.byteOffset + image.byteLength
  ) as ArrayBuffer
}

function sharpInput(bytes: Uint8Array): SharpConstructorInput {
  return bytes as unknown as SharpConstructorInput
}

function sharpOverlayInput(bytes: Uint8Array): SharpOverlayInput {
  return bytes as unknown as SharpOverlayInput
}

function loginSplashImageUrl(generatedAt: string | null): string {
  const parsed = generatedAt ? Date.parse(generatedAt) : Date.now()
  const version = Number.isFinite(parsed) ? parsed : Date.now()
  return new URL(
    `${LOGIN_SPLASH_IMAGE_PATH}?v=${version}`,
    env.PUBLIC_SERVER_URL
  ).toString()
}

function loginSplashCacheKey(rows: SplashClipRow[]): string {
  const generatedAt =
    configStore.get("appearance").loginSplash.generatedAt ?? "pending"
  return `${LOGIN_SPLASH_LAYOUT_VERSION}:${generatedAt}:${rows
    .map((row) => `${row.id}:${row.thumbKey}`)
    .join(",")}`
}

async function buildTile(asset: SplashClipAsset): Promise<Uint8Array> {
  return await sharp(sharpInput(asset.bytes))
    .resize(TILE_WIDTH, TILE_HEIGHT, { fit: "cover" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
}

function splashShadeOverlay(): Uint8Array {
  if (splashShadeCache) return splashShadeCache

  const pixels = new Uint8Array(SPLASH_WIDTH * SPLASH_HEIGHT * 4)
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
      pixels[index + 3] = Math.round(56 + rightShade + bottomShade + vignette)
    }
  }

  splashShadeCache = pixels
  return pixels
}

async function buildLoginSplashImage(
  assets: SplashClipAsset[]
): Promise<Uint8Array | null> {
  const tiles = await Promise.all(
    assets.map((asset) => buildTile(asset).catch(() => null))
  )
  const usableTiles = tiles.filter((tile): tile is Uint8Array => tile !== null)
  if (usableTiles.length === 0) return null

  const rotationRadians = (TILE_ROTATION_DEGREES * Math.PI) / 180
  const rotationCoverWidth =
    SPLASH_WIDTH * Math.abs(Math.cos(rotationRadians)) +
    SPLASH_HEIGHT * Math.abs(Math.sin(rotationRadians))
  const rotationCoverHeight =
    SPLASH_WIDTH * Math.abs(Math.sin(rotationRadians)) +
    SPLASH_HEIGHT * Math.abs(Math.cos(rotationRadians))
  const gridWidth = Math.ceil(
    rotationCoverWidth + (TILE_WIDTH + TILE_GAP) * TILE_GRID_MARGIN_STEPS
  )
  const gridHeight = Math.ceil(
    rotationCoverHeight + (TILE_HEIGHT + TILE_GAP) * TILE_GRID_MARGIN_STEPS
  )
  const columnCount =
    Math.ceil((gridWidth + TILE_GAP) / (TILE_WIDTH + TILE_GAP)) + 1
  const rowCount =
    Math.ceil((gridHeight + TILE_GAP) / (TILE_HEIGHT + TILE_GAP)) + 1
  const contentWidth = columnCount * TILE_WIDTH + (columnCount - 1) * TILE_GAP
  const contentHeight = rowCount * TILE_HEIGHT + (rowCount - 1) * TILE_GAP
  const startLeft = Math.floor((gridWidth - contentWidth) / 2)
  const startTop = Math.floor((gridHeight - contentHeight) / 2)

  const composites: sharp.OverlayOptions[] = []
  let tileIndex = 0
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const top = startTop + rowIndex * (TILE_HEIGHT + TILE_GAP)
    const rowShift =
      TILE_ROW_SHIFT * (TILE_ROW_SHIFTS[rowIndex % TILE_ROW_SHIFTS.length] ?? 0)
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const left = Math.round(
        startLeft + rowShift + columnIndex * (TILE_WIDTH + TILE_GAP)
      )
      const tile = usableTiles[tileIndex % usableTiles.length]
      if (!tile) continue
      composites.push({ input: sharpOverlayInput(tile), left, top })
      tileIndex++
    }
  }

  if (composites.length === 0) return null

  const rotatedBackdrop = await sharp({
    create: {
      width: gridWidth,
      height: gridHeight,
      channels: 3,
      background: "#050609",
    },
  })
    .composite(composites)
    .rotate(TILE_ROTATION_DEGREES, { background: "#050609" })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  const tiledBackdrop = await sharp(sharpInput(rotatedBackdrop.data))
    .extract({
      left: Math.floor((rotatedBackdrop.info.width - SPLASH_WIDTH) / 2),
      top: Math.floor((rotatedBackdrop.info.height - SPLASH_HEIGHT) / 2),
      width: SPLASH_WIDTH,
      height: SPLASH_HEIGHT,
    })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer()

  const blurredTiles = await sharp(sharpInput(tiledBackdrop))
    .blur(18)
    .modulate({ brightness: 0.64, saturation: 0.9 })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()

  return sharp({
    create: {
      width: SPLASH_WIDTH,
      height: SPLASH_HEIGHT,
      channels: 3,
      background: "#050609",
    },
  })
    .composite([
      { input: sharpOverlayInput(blurredTiles), left: 0, top: 0 },
      { input: sharpOverlayInput(tiledBackdrop), left: 0, top: 0 },
      {
        input: sharpOverlayInput(splashShadeOverlay()),
        raw: {
          width: SPLASH_WIDTH,
          height: SPLASH_HEIGHT,
          channels: 4,
        },
        left: 0,
        top: 0,
      },
    ])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer()
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
        isNull(user.disabledAt)
      )
    )

  const byId = new Map(rows.map((row) => [row.id, row]))
  return loginSplash.clipIds.flatMap((id) => {
    const row = byId.get(id)
    return row?.thumbKey ? [{ ...row, thumbKey: row.thumbKey }] : []
  })
}

async function selectLoginSplashAssets(
  rows: SplashClipRow[]
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

    return c.json({
      ...setupStatus,
      openRegistrations: configStore.get("openRegistrations"),
      passkeyEnabled: configStore.get("passkeyEnabled"),
      requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
      provider: getPublicProvider(),
      loginSplash: {
        enabled: loginSplash.enabled,
        generatedAt: loginSplash.generatedAt,
        imageUrl:
          loginSplash.enabled && splashRows.length > 0
            ? loginSplashImageUrl(loginSplash.generatedAt)
            : null,
        clips: [],
      },
    } satisfies PublicAuthConfig)
  })
  .get(LEGACY_SPLASH_IMAGE_PATH, (c) => {
    const url = new URL(c.req.url)
    url.pathname = LOGIN_SPLASH_IMAGE_PATH
    return c.redirect(url.toString(), 302)
  })
  .get(LOGIN_SPLASH_IMAGE_PATH.replace("/api/auth-config", ""), async (c) => {
    const rows = await selectLoginSplashRows()
    if (rows.length === 0) return c.json({ error: "Not found" }, 404)

    const cacheKey = loginSplashCacheKey(rows)
    if (splashCache?.key === cacheKey) {
      c.header("Content-Type", SPLASH_CONTENT_TYPE)
      c.header("Content-Length", String(splashCache.image.byteLength))
      c.header("Cache-Control", "public, max-age=86400")
      return c.body(imageBody(splashCache.image))
    }

    const assets = await selectLoginSplashAssets(rows)
    if (assets.length === 0) return c.json({ error: "Not found" }, 404)

    const image = await buildLoginSplashImage(assets)
    if (!image) return c.json({ error: "Not found" }, 404)
    if (image.byteLength <= SPLASH_CACHE_MAX_BYTES) {
      splashCache = { key: cacheKey, image }
    }
    c.header("Content-Type", SPLASH_CONTENT_TYPE)
    c.header("Content-Length", String(image.byteLength))
    c.header("Cache-Control", "public, max-age=86400")
    return c.body(imageBody(image))
  })
