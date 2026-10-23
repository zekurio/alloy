import {
  type AdminGameRow,
  GAME_ASSET_ROLES,
  type GameAssetRole,
  type SteamGridDBArtworkResponse,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { clip, game } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import {
  availableGameSlug,
  gameSelection,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import { browseGameArtwork } from "@alloy/server/games/steamgriddb"
import {
  badRequest,
  deleted,
  errorResult,
  notFound,
} from "@alloy/server/runtime/http-response"
import { imageBodyLimit } from "@alloy/server/uploads/image-body-limit"
import { eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"

import { prepareGameAsset, type PreparedGameAsset } from "./admin-game-assets"
import {
  createCustomGame,
  deleteGame,
  removeGameAsset,
  updateGame,
  uploadGameAsset,
} from "./admin-games-store"
import { steamgriddbErrorResponse } from "./games-helpers"
import { requiredTrimmedString, tbValidator } from "./validation"

export { gameAssetsRoute } from "./admin-game-assets"

// The blurhash step reads any other scheme as a local file path.
const NullableUrl = t
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), "must be an http(s) URL")
  .nullable()
  .optional()
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
const GameArtworkQuery = t.object({ role: t.enum(GAME_ASSET_ROLES) })
const GameAssetUploadForm = t.object({
  file: t.instanceof(File, { message: "Expected an uploaded image file" }),
})

// Lets routes that process images fail before that work. The store checks
// again under its row lock, so routes without that work can skip this.
/** Loads the game named by the `:id` param, or 404s. */
const loadGame = createMiddleware<{
  Variables: { game: { id: string; steamgriddbId: number | null } }
}>(async (c, next) => {
  const [row] = await db
    .select({ id: game.id, steamgriddbId: game.steamgriddb_id })
    .from(game)
    .where(eq(game.id, c.req.param("id") ?? ""))
    .limit(1)
  if (!row) return notFound(c, "Unknown game")
  c.set("game", row)
  await next()
})

export const adminGamesRoute = new Hono()
  .get("/games", async (c) => c.json(await listAdminGames()))
  .post(
    "/games",
    imageBodyLimit("gameAssetMaxBytes", GAME_ASSET_ROLES.length),
    tbValidator("form", CreateGameForm),
    async (c) => {
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

      const slug = await availableGameSlug(body.name)
      const result = await createCustomGame({
        name: body.name,
        slug,
        releaseDate: body.releaseDate ? new Date(body.releaseDate) : null,
        assets,
      })
      return result.ok ? c.json(result.game, 201) : errorResult(c, result)
    },
  )
  .patch(
    "/games/:id",
    tbValidator("param", GameIdParam),
    tbValidator("json", UpdateGameBody),
    loadGame,
    async (c) => {
      const result = await updateGame(c.var.game.id, c.req.valid("json"))
      return result.ok ? c.json(result.game) : errorResult(c, result)
    },
  )
  .delete("/games/:id", tbValidator("param", GameIdParam), async (c) => {
    const { id } = c.req.valid("param")
    const result = await deleteGame(id)
    return result.ok ? deleted(c) : errorResult(c, result)
  })
  // SteamGridDB artwork the admin can apply to a game by role. Only meaningful
  // for games that still carry a SteamGridDB id.
  .get(
    "/games/:id/artwork",
    tbValidator("param", GameIdParam),
    tbValidator("query", GameArtworkQuery),
    loadGame,
    async (c) => {
      const { role } = c.req.valid("query")
      const { steamgriddbId } = c.var.game
      if (steamgriddbId === null) {
        return badRequest(c, "This game has no SteamGridDB artwork")
      }

      try {
        const assets = await browseGameArtwork(steamgriddbId, role)
        return c.json({ assets } satisfies SteamGridDBArtworkResponse)
      } catch (err) {
        return errorResult(c, steamgriddbErrorResponse(err))
      }
    },
  )
  .post(
    "/games/:id/assets/:role",
    tbValidator("param", GameAssetParam),
    imageBodyLimit("gameAssetMaxBytes"),
    tbValidator("form", GameAssetUploadForm),
    loadGame,
    async (c) => {
      const result = await uploadGameAsset(
        c.var.game.id,
        c.req.valid("param").role,
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
      const result = await removeGameAsset(id, role)
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
