import { Buffer } from "node:buffer"

import {
  GAME_ASSET_ROLES,
  gameAssetImagePath,
  type GameAssetRole,
} from "@alloy/contracts"
import { game } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import {
  imageBlurHash,
  imageBlurHashFromBytes,
} from "@alloy/server/media/blurhash"
import { validateImageBytes } from "@alloy/server/media/image-validation"
import { ifNoneMatchSatisfied } from "@alloy/server/runtime/http-conditional"
import { notFound } from "@alloy/server/runtime/http-response"
import type { ResolvedObject } from "@alloy/server/storage/driver"
import { gameAssetKey, gameAssetStorage } from "@alloy/server/storage/index"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import sharp from "sharp"

const logger = createLogger("admin-games")

const GAME_ASSET_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const GAME_ASSET_CONTENT_TYPE = "image/webp"
const GAME_ASSET_EXT = ".webp"
const GAME_ASSET_KEY_RE =
  /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:hero|grid|logo|icon)\.webp$/i

const EXT_FOR_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
}

// Standardized output sizes. Hero/grid are cropped to a fixed frame; logo and
// icon keep their aspect ratio and transparency (no flatten).
const GAME_ASSET_TARGETS = {
  hero: { width: 1920, height: 620, fit: "cover" },
  grid: { width: 600, height: 900, fit: "cover" },
  logo: { width: 600, height: 600, fit: "inside" },
  icon: { width: 256, height: 256, fit: "inside" },
} as const

const GAME_ASSET_URL_COLUMN: Record<
  GameAssetRole,
  "hero_url" | "grid_url" | "logo_url" | "icon_url"
> = {
  hero: "hero_url",
  grid: "grid_url",
  logo: "logo_url",
  icon: "icon_url",
}

const GAME_ASSET_BLUR_COLUMN: Partial<
  Record<GameAssetRole, "hero_blur_hash" | "grid_blur_hash">
> = {
  hero: "hero_blur_hash",
  grid: "grid_blur_hash",
}

type PreparedGameAsset =
  | { ok: true; bytes: Buffer }
  | { ok: false; status: ContentfulStatusCode; error: string }

export async function prepareGameAsset(
  role: GameAssetRole,
  file: File,
): Promise<PreparedGameAsset> {
  if (file.size === 0) {
    return { ok: false, status: 400, error: "Empty image data" }
  }
  if (file.size > GAME_ASSET_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Image too large. Max ${GAME_ASSET_MAX_BYTES / 1024 / 1024} MB`,
    }
  }
  if (!Object.hasOwn(EXT_FOR_CONTENT_TYPE, file.type)) {
    return { ok: false, status: 400, error: "Unsupported image type" }
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const validation = validateImageBytes(buf, file.type)
  if (!validation.ok) return { ok: false, status: 400, error: validation.error }

  try {
    return { ok: true, bytes: await processGameAsset(role, buf) }
  } catch (cause) {
    logger.error(`failed to process ${role} image:`, cause)
    return { ok: false, status: 400, error: "Could not process image" }
  }
}

export async function storeGameAsset(
  gameId: string,
  role: GameAssetRole,
  bytes: Buffer,
  updatedAt: Date,
): Promise<Partial<typeof game.$inferInsert>> {
  const key = gameAssetKey(gameId, role, GAME_ASSET_EXT)
  await gameAssetStorage.put(key, bytes, GAME_ASSET_CONTENT_TYPE)

  const patch: Partial<typeof game.$inferInsert> = {}
  patch[GAME_ASSET_URL_COLUMN[role]] = gameAssetImagePath(key, updatedAt)
  const blurColumn = GAME_ASSET_BLUR_COLUMN[role]
  if (blurColumn) {
    patch[blurColumn] = await imageBlurHashFromBytes(bytes).catch(() => null)
  }
  return patch
}

export async function urlAssetColumns(input: {
  heroUrl?: string | null
  gridUrl?: string | null
  logoUrl?: string | null
  iconUrl?: string | null
}): Promise<Partial<typeof game.$inferInsert>> {
  const patch: Partial<typeof game.$inferInsert> = {}
  if (input.heroUrl !== undefined) {
    patch.hero_url = input.heroUrl
    patch.hero_blur_hash = input.heroUrl
      ? await blurHashForUrl(input.heroUrl)
      : null
  }
  if (input.gridUrl !== undefined) {
    patch.grid_url = input.gridUrl
    patch.grid_blur_hash = input.gridUrl
      ? await blurHashForUrl(input.gridUrl)
      : null
  }
  if (input.logoUrl !== undefined) patch.logo_url = input.logoUrl
  if (input.iconUrl !== undefined) patch.icon_url = input.iconUrl
  return patch
}

export async function deleteAllGameAssets(gameId: string): Promise<void> {
  await Promise.all(
    GAME_ASSET_ROLES.map((role) =>
      gameAssetStorage.delete(gameAssetKey(gameId, role, GAME_ASSET_EXT)),
    ),
  )
}

export async function removeGameAsset(
  gameId: string,
  role: GameAssetRole,
): Promise<void> {
  await gameAssetStorage.delete(gameAssetKey(gameId, role, GAME_ASSET_EXT))
  const patch: Partial<typeof game.$inferInsert> = { updated_at: new Date() }
  patch[GAME_ASSET_URL_COLUMN[role]] = null
  const blurColumn = GAME_ASSET_BLUR_COLUMN[role]
  if (blurColumn) patch[blurColumn] = null
  await db.update(game).set(patch).where(eq(game.id, gameId))
}

function processGameAsset(role: GameAssetRole, bytes: Buffer): Promise<Buffer> {
  const target = GAME_ASSET_TARGETS[role]
  return sharp(bytes)
    .rotate()
    .resize(target.width, target.height, {
      fit: target.fit,
      withoutEnlargement: target.fit === "inside",
    })
    .webp()
    .toBuffer()
}

async function blurHashForUrl(url: string): Promise<string | null> {
  try {
    return await imageBlurHash({ source: url, label: "game asset blurhash" })
  } catch (err) {
    logger.warn(`failed to compute blurhash for ${url}:`, err)
    return null
  }
}

function assetEtag(key: string, resolved: ResolvedObject): string {
  const modified = resolved.lastModified?.getTime() ?? 0
  return `"${Buffer.from(`${key}:${resolved.size}:${modified}`).toString(
    "base64url",
  )}"`
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const out = Buffer.alloc(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export const gameAssetsRoute = new Hono().get("/:key{.+}", async (c) => {
  const key = c.req.param("key") ?? ""
  if (!key || !GAME_ASSET_KEY_RE.test(key)) return notFound(c)

  const resolved = await gameAssetStorage.resolve(key)
  if (!resolved) return notFound(c)
  const etag = assetEtag(key, resolved)

  c.header("ETag", etag)
  if (resolved.lastModified) {
    c.header("Last-Modified", resolved.lastModified.toUTCString())
  }
  c.header("Cache-Control", "public, max-age=86400, immutable")

  if (ifNoneMatchSatisfied(c.req.header("if-none-match"), etag)) {
    return c.body(null, 304)
  }

  c.header("Content-Type", resolved.contentType)
  const buf = await readAll(resolved.stream())
  c.header("Content-Length", String(buf.byteLength))

  return c.body(
    buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer,
  )
})
