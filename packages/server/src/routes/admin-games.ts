import {
  type AdminGameRow,
  GAME_ASSET_ROLES,
  type GameAssetRole,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { clip, game } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import {
  availableCustomGameSlug,
  gameSelection,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import { deleted, errorResult } from "@alloy/server/runtime/http-response"
import { eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import { prepareGameAsset, type PreparedGameAsset } from "./admin-game-assets"
import {
  createCustomGame,
  deleteCustomGame,
  removeCustomGameAsset,
  selectCustomGame,
  updateCustomGame,
  uploadGameAsset,
} from "./admin-games-store"
import { requiredTrimmedString, tbValidator } from "./validation"

export { gameAssetsRoute } from "./admin-game-assets"

const NullableUrl = t.url().max(2048).nullable().optional()
const NullableReleaseDate = t.iso
  .datetime({ offset: true })
  .nullable()
  .optional()

// One-step creation: metadata and artwork arrive in a single multipart form,
// so a game never exists without the assets the admin picked for it.
const CreateGameForm = t.object({
  name: requiredTrimmedString(120),
  releaseDate: t.iso.datetime({ offset: true }).optional(),
  hero: t.instanceof(File).optional(),
  grid: t.instanceof(File).optional(),
  logo: t.instanceof(File).optional(),
  icon: t.instanceof(File).optional(),
})

const UpdateGameBody = t
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

const GameIdParam = t.object({ id: t.uuid() })
const GameAssetParam = t.object({
  id: t.uuid(),
  role: t.enum(GAME_ASSET_ROLES),
})
const GameAssetUploadForm = t.object({
  file: t.instanceof(File, { message: "Expected an uploaded image file" }),
})

export const adminGamesRoute = new Hono()
  .get("/games", async (c) => c.json(await listAdminGames()))
  .post("/games", tbValidator("form", CreateGameForm), async (c) => {
    const body = c.req.valid("form")

    // Validate and process every provided artwork upfront so a bad image
    // fails the request before the game row exists.
    const assets: {
      role: GameAssetRole
      prepared: Extract<PreparedGameAsset, { ok: true }>
    }[] = []
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
      assets.push({ role, prepared })
    }

    const slug = await availableCustomGameSlug(body.name, null)
    const result = await createCustomGame({
      name: body.name,
      slug,
      releaseDate: body.releaseDate ? new Date(body.releaseDate) : null,
      assets,
    })
    return result.ok ? c.json(result.game, 201) : errorResult(c, result)
  })
  .patch(
    "/games/:id",
    tbValidator("param", GameIdParam),
    tbValidator("json", UpdateGameBody),
    async (c) => {
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const existing = await selectCustomGame(c, id)
      if ("response" in existing) return existing.response

      const result = await updateCustomGame(existing.row.id, body)
      return result.ok ? c.json(result.game) : errorResult(c, result)
    },
  )
  .delete("/games/:id", tbValidator("param", GameIdParam), async (c) => {
    const { id } = c.req.valid("param")
    const existing = await selectCustomGame(c, id)
    if ("response" in existing) return existing.response

    await deleteCustomGame(existing.row.id)
    return deleted(c)
  })
  .post(
    "/games/:id/assets/:role",
    tbValidator("param", GameAssetParam),
    tbValidator("form", GameAssetUploadForm),
    async (c) => {
      const { id, role } = c.req.valid("param")
      const existing = await selectCustomGame(c, id)
      if ("response" in existing) return existing.response

      const result = await uploadGameAsset(
        existing.row.id,
        role,
        c.req.valid("form").file,
      )
      return result.ok ? c.json(result.game) : errorResult(c, result)
    },
  )
  .delete(
    "/games/:id/assets/:role",
    tbValidator("param", GameAssetParam),
    async (c) => {
      const { id, role } = c.req.valid("param")
      const existing = await selectCustomGame(c, id)
      if ("response" in existing) return existing.response

      const result = await removeCustomGameAsset(existing.row.id, role)
      return result.ok ? c.json(result.game) : errorResult(c, result)
    },
  )

async function listAdminGames(): Promise<AdminGameRow[]> {
  const rows = await db
    .select({
      ...gameSelection,
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
