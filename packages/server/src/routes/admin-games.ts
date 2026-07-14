import type { Buffer } from "node:buffer"

import {
  type AdminGameRow,
  GAME_ASSET_ROLES,
  type GameAssetRole,
} from "@alloy/contracts"
import { clip, game } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import {
  availableCustomGameSlug,
  gameSelectShape,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import {
  badRequest,
  deleted,
  errorResult,
  notFound,
} from "@alloy/server/runtime/http-response"
import { eq, sql } from "drizzle-orm"
import { type Context, Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"

import {
  deleteAllGameAssets,
  prepareGameAsset,
  removeGameAsset,
  storeGameAsset,
  urlAssetColumns,
} from "./admin-game-assets"
import { requiredTrimmedString, zValidator } from "./validation"

export { gameAssetsRoute } from "./admin-game-assets"

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

    await deleteAllGameAssets(id)
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

      await removeGameAsset(id, role)

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
