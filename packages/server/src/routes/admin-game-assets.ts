import { Buffer } from "node:buffer"

import { gameAssetImagePath, type GameAssetRole } from "@alloy/contracts"
import { game } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { GAME_ASSET_ROUTE_KEY_RE } from "@alloy/server/games/game-asset-deletion"
import {
  imageBlurHash,
  imageBlurHashFromBytes,
} from "@alloy/server/media/blurhash"
import { validateImageBytes } from "@alloy/server/media/image-validation"
import { gameAssetStorage } from "@alloy/server/storage/index"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import sharp from "sharp"

import { immutableImageAssetsRoute } from "./immutable-image-assets"

const logger = createLogger("admin-games")

const GAME_ASSET_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const GAME_ASSET_CONTENT_TYPE = "image/webp"
const GAME_ASSET_EXT = ".webp"
const EXT_FOR_CONTENT_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} satisfies Record<string, string>

// Standardized output sizes. Hero/grid are cropped to a fixed frame; logo and
// icon keep their aspect ratio and transparency (no flatten).
const GAME_ASSET_TARGETS = {
  hero: { width: 1920, height: 620, fit: "cover" },
  grid: { width: 600, height: 900, fit: "cover" },
  logo: { width: 600, height: 600, fit: "inside" },
  icon: { width: 256, height: 256, fit: "inside" },
} as const

const GAME_ASSET_URL_COLUMN = {
  hero: "hero_url",
  grid: "grid_url",
  logo: "logo_url",
  icon: "icon_url",
} satisfies Record<
  GameAssetRole,
  "hero_url" | "grid_url" | "logo_url" | "icon_url"
>

const GAME_ASSET_BLUR_COLUMN = new Map<
  GameAssetRole,
  "hero_blur_hash" | "grid_blur_hash"
>([
  ["hero", "hero_blur_hash"],
  ["grid", "grid_blur_hash"],
])

export type PreparedGameAsset =
  | { ok: true; bytes: Buffer; blurHash: string | null }
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
    const bytes = await processGameAsset(role, buf)
    const blurHash = GAME_ASSET_BLUR_COLUMN.has(role)
      ? await imageBlurHashFromBytes(bytes).catch(() => null)
      : null
    return { ok: true, bytes, blurHash }
  } catch (cause) {
    logger.error(`failed to process ${role} image:`, cause)
    return { ok: false, status: 400, error: "Could not process image" }
  }
}

export function gameAssetColumns(
  role: GameAssetRole,
  key: string,
  prepared: Extract<PreparedGameAsset, { ok: true }>,
  updatedAt: Date,
): Partial<typeof game.$inferInsert> {
  const patch: Partial<typeof game.$inferInsert> = {}
  patch[GAME_ASSET_URL_COLUMN[role]] = gameAssetImagePath(key, updatedAt)
  const blurColumn = GAME_ASSET_BLUR_COLUMN.get(role)
  if (blurColumn) patch[blurColumn] = prepared.blurHash
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

export function clearedGameAssetColumns(
  role: GameAssetRole,
): Partial<typeof game.$inferInsert> {
  const patch: Partial<typeof game.$inferInsert> = { updated_at: new Date() }
  patch[GAME_ASSET_URL_COLUMN[role]] = null
  const blurColumn = GAME_ASSET_BLUR_COLUMN.get(role)
  if (blurColumn) patch[blurColumn] = null
  return patch
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

export const gameAssetsRoute = immutableImageAssetsRoute(
  gameAssetStorage,
  GAME_ASSET_ROUTE_KEY_RE,
)

export { GAME_ASSET_CONTENT_TYPE, GAME_ASSET_EXT }
