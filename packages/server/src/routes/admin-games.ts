import { Buffer } from "node:buffer"

import {
  type AdminGameRow,
  GAME_ASSET_ROLES,
  gameAssetImagePath,
  type GameAssetRole,
} from "@alloy/contracts"
import { clip, game } from "@alloy/db/schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import {
  availableCustomGameSlug,
  gameSelectShape,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import {
  imageBlurHash,
  imageBlurHashFromBytes,
} from "@alloy/server/media/blurhash"
import { validateImageBytes } from "@alloy/server/media/image-validation"
import { ifNoneMatchSatisfied } from "@alloy/server/runtime/http-conditional"
import {
  badRequest,
  deleted,
  errorResult,
  notFound,
} from "@alloy/server/runtime/http-response"
import type { ResolvedObject } from "@alloy/server/storage/driver"
import { gameAssetKey, gameAssetStorage } from "@alloy/server/storage/index"
import { eq, sql } from "drizzle-orm"
import { type Context, Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import sharp from "sharp"
import { z } from "zod"

import { requiredTrimmedString, zValidator } from "./validation"

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

const NullableUrl = z.url().max(2048).nullable().optional()
const NullableReleaseDate = z.iso
  .datetime({ offset: true })
  .nullable()
  .optional()

// One-step creation: metadata and artwork arrive in a single multipart form,
// so a game never exists without the assets the admin picked for it.
const CreateGameForm = z.object({
  name: requiredTrimmedString(120),
  releaseDate: z.iso.datetime({ offset: true }).optional(),
  hero: z.instanceof(File).optional(),
  grid: z.instanceof(File).optional(),
  logo: z.instanceof(File).optional(),
  icon: z.instanceof(File).optional(),
})

const UpdateGameBody = z
  .object({
    name: requiredTrimmedString(120).optional(),
    slug: requiredTrimmedString(64).optional(),
    releaseDate: NullableReleaseDate,
    heroUrl: NullableUrl,
    gridUrl: NullableUrl,
    logoUrl: NullableUrl,
    iconUrl: NullableUrl,
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "No updates provided",
  })

const GameIdParam = z.object({ id: z.uuid() })
const GameAssetParam = z.object({
  id: z.uuid(),
  role: z.enum(GAME_ASSET_ROLES),
})
const GameAssetUploadForm = z.object({
  file: z.instanceof(File, { message: "Expected an uploaded image file" }),
})

export const adminGamesRoute = new Hono()
  .get("/games", async (c) => c.json(await listAdminGames()))
  .post("/games", zValidator("form", CreateGameForm), async (c) => {
    const body = c.req.valid("form")

    // Validate and process every provided artwork upfront so a bad image
    // fails the request before the game row exists.
    const assets: { role: GameAssetRole; bytes: Buffer }[] = []
    for (const role of GAME_ASSET_ROLES) {
      const file = body[role]
      if (!file) continue
      const prepared = await prepareGameAsset(role, file)
      if (!prepared.ok) {
        return errorResult(c, {
          status: prepared.status,
          error: `${role}: ${prepared.error}`,
        })
      }
      assets.push({ role, bytes: prepared.bytes })
    }

    const slug = await availableCustomGameSlug(body.name, null)
    const [inserted] = await db
      .insert(game)
      .values({
        source: "custom",
        name: body.name,
        slug,
        release_date: body.releaseDate ? new Date(body.releaseDate) : null,
      })
      .returning({ id: game.id })
    if (!inserted) return badRequest(c, "Could not create game")

    if (assets.length > 0) {
      const updatedAt = new Date()
      const patch: Partial<typeof game.$inferInsert> = {
        updated_at: updatedAt,
      }
      for (const asset of assets) {
        Object.assign(
          patch,
          await storeGameAsset(inserted.id, asset.role, asset.bytes, updatedAt),
        )
      }
      await db.update(game).set(patch).where(eq(game.id, inserted.id))
    }

    const result = await loadAdminGame(inserted.id)
    return result.ok ? c.json(result.game, 201) : errorResult(c, result)
  })
  .patch(
    "/games/:id",
    zValidator("param", GameIdParam),
    zValidator("json", UpdateGameBody),
    async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const existing = await selectCustomGame(c, id)
      if ("response" in existing) return existing.response

      const patch: Partial<typeof game.$inferInsert> = {
        updated_at: new Date(),
        ...(await urlAssetColumns(body)),
      }
      if (body.name !== undefined) patch.name = body.name
      // Slug only changes on an explicit request — renaming a game keeps its
      // existing URLs working.
      if (body.slug !== undefined) {
        patch.slug = await availableCustomGameSlug(body.slug, id)
      }
      if (body.releaseDate !== undefined) {
        patch.release_date = body.releaseDate
          ? new Date(body.releaseDate)
          : null
      }

      await db.update(game).set(patch).where(eq(game.id, id))
      const result = await loadAdminGame(id)
      return result.ok ? c.json(result.game) : errorResult(c, result)
    },
  )
  .delete("/games/:id", zValidator("param", GameIdParam), async (c) => {
    const { id } = c.req.valid("param")
    const existing = await selectCustomGame(c, id)
    if ("response" in existing) return existing.response

    await Promise.all(
      GAME_ASSET_ROLES.map((role) =>
        gameAssetStorage.delete(gameAssetKey(id, role, GAME_ASSET_EXT)),
      ),
    )
    // FK cleanup: clip.game_id is set null, game_follow rows cascade.
    await db.delete(game).where(eq(game.id, id))
    return deleted(c)
  })
  .post(
    "/games/:id/assets/:role",
    zValidator("param", GameAssetParam),
    zValidator("form", GameAssetUploadForm),
    async (c) => {
      const { id, role } = c.req.valid("param")
      const existing = await selectCustomGame(c, id)
      if ("response" in existing) return existing.response

      const result = await uploadGameAsset(id, role, c.req.valid("form").file)
      return result.ok ? c.json(result.game) : errorResult(c, result)
    },
  )
  .delete(
    "/games/:id/assets/:role",
    zValidator("param", GameAssetParam),
    async (c) => {
      const { id, role } = c.req.valid("param")
      const existing = await selectCustomGame(c, id)
      if ("response" in existing) return existing.response

      await gameAssetStorage.delete(gameAssetKey(id, role, GAME_ASSET_EXT))
      const patch: Partial<typeof game.$inferInsert> = {
        updated_at: new Date(),
      }
      patch[GAME_ASSET_URL_COLUMN[role]] = null
      const blurColumn = GAME_ASSET_BLUR_COLUMN[role]
      if (blurColumn) patch[blurColumn] = null
      await db.update(game).set(patch).where(eq(game.id, id))

      const result = await loadAdminGame(id)
      return result.ok ? c.json(result.game) : errorResult(c, result)
    },
  )

async function listAdminGames(): Promise<AdminGameRow[]> {
  const rows = await db
    .select({
      ...gameSelectShape,
      clipCount: sql<number>`count(${clip.id})::int`,
    })
    .from(game)
    .leftJoin(clip, eq(clip.game_id, game.id))
    .groupBy(game.id)
    .orderBy(sql`${game.source} = 'custom' desc`, game.name)
  return rows.map((row) => ({
    ...serialiseGameRow(row),
    clipCount: row.clipCount,
  }))
}

type CustomGameLookup = { row: { id: string } } | { response: Response }

async function selectCustomGame(
  c: Context,
  gameId: string,
): Promise<CustomGameLookup> {
  const [row] = await db
    .select({ id: game.id, source: game.source })
    .from(game)
    .where(eq(game.id, gameId))
    .limit(1)
  if (!row) return { response: notFound(c, "Unknown game") }
  if (row.source !== "custom") {
    return { response: badRequest(c, "Only custom games can be edited") }
  }
  return { row: { id: row.id } }
}

type AdminGameResult =
  | { ok: true; game: AdminGameRow }
  | { ok: false; status: ContentfulStatusCode; error: string }

async function loadAdminGame(gameId: string): Promise<AdminGameResult> {
  const [row] = await db
    .select({
      ...gameSelectShape,
      clipCount: sql<number>`count(${clip.id})::int`,
    })
    .from(game)
    .leftJoin(clip, eq(clip.game_id, game.id))
    .where(eq(game.id, gameId))
    .groupBy(game.id)
    .limit(1)
  if (!row) return { ok: false, status: 500, error: "Game did not persist" }
  return {
    ok: true,
    game: { ...serialiseGameRow(row), clipCount: row.clipCount },
  }
}

async function urlAssetColumns(input: {
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

async function blurHashForUrl(url: string): Promise<string | null> {
  try {
    return await imageBlurHash({ source: url, label: "game asset blurhash" })
  } catch (err) {
    logger.warn(`failed to compute blurhash for ${url}:`, err)
    return null
  }
}

type PreparedGameAsset =
  | { ok: true; bytes: Buffer }
  | { ok: false; status: ContentfulStatusCode; error: string }

async function prepareGameAsset(
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

async function storeGameAsset(
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

async function uploadGameAsset(
  gameId: string,
  role: GameAssetRole,
  file: File,
): Promise<AdminGameResult> {
  const prepared = await prepareGameAsset(role, file)
  if (!prepared.ok) return prepared

  const updatedAt = new Date()
  const patch: Partial<typeof game.$inferInsert> = {
    updated_at: updatedAt,
    ...(await storeGameAsset(gameId, role, prepared.bytes, updatedAt)),
  }
  await db.update(game).set(patch).where(eq(game.id, gameId))

  return loadAdminGame(gameId)
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
  if (!key || !GAME_ASSET_KEY_RE.test(key)) {
    return notFound(c)
  }

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
