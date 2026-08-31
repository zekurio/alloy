import { randomUUID } from "node:crypto"

import {
  type AdminGameRow,
  GAME_ASSET_ROLES,
  type GameAssetRole,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { clip, game } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { withGameAssetMutation } from "@alloy/server/games/game-asset-activity"
import {
  gameAssetDeletionIntents,
  prewriteGameAssetDeletionIntent,
} from "@alloy/server/games/game-asset-deletion"
import {
  availableCustomGameSlug,
  gameSelection,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import {
  badRequest,
  deleted,
  errorResult,
  notFound,
} from "@alloy/server/runtime/http-response"
import {
  cancelStorageDeletion,
  enqueueStorageDeletion,
} from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import {
  gameAssetStorage,
  versionedGameAssetKey,
} from "@alloy/server/storage/index"
import { withStorageObjectWriteActivity } from "@alloy/server/storage/write-activity"
import { eq, getTableColumns, sql } from "drizzle-orm"
import { type Context, Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import {
  clearedGameAssetColumns,
  GAME_ASSET_CONTENT_TYPE,
  GAME_ASSET_EXT,
  gameAssetColumns,
  prepareGameAsset,
  type PreparedGameAsset,
  urlAssetColumns,
} from "./admin-game-assets"
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

const PREWRITE_DELETION_DELAY_MS = 60 * 1000
const GAME_ASSET_URL_COLUMN = {
  hero: "hero_url",
  grid: "grid_url",
  logo: "logo_url",
  icon: "icon_url",
} as const
const GAME_ASSET_INPUT_COLUMN = {
  hero: "heroUrl",
  grid: "gridUrl",
  logo: "logoUrl",
  icon: "iconUrl",
} as const

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

type LockedCustomGame = typeof game.$inferSelect

async function lockCustomGame(
  tx: DbTransaction,
  gameId: string,
): Promise<LockedCustomGame | null> {
  const [row] = await tx
    .select({ row: getTableColumns(game) })
    .from(game)
    .where(eq(game.id, gameId))
    .limit(1)
    .for("update")
  return row?.row.source === "custom" ? row.row : null
}

async function enqueueGameAssetIntents(
  tx: DbTransaction,
  intents: ReturnType<typeof gameAssetDeletionIntents>,
): Promise<void> {
  for (const intent of intents) await enqueueStorageDeletion(intent, { tx })
}

function missingGameResult(): AdminGameResult {
  return { ok: false, status: 404, error: "Unknown game" }
}

async function loadAdminGame(gameId: string): Promise<AdminGameResult> {
  const [row] = await db
    .select({
      ...gameSelection,
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

async function createCustomGame(input: {
  name: string
  slug: string
  releaseDate: Date | null
  assets: {
    role: GameAssetRole
    prepared: Extract<PreparedGameAsset, { ok: true }>
  }[]
}): Promise<AdminGameResult> {
  const gameId = randomUUID()
  const writes = input.assets.map((asset) => {
    const attemptId = randomUUID()
    return {
      ...asset,
      attemptId,
      key: versionedGameAssetKey(gameId, asset.role, attemptId, GAME_ASSET_EXT),
    }
  })
  let wakeAfterWrite = false
  try {
    return await withGameAssetMutation(gameId, () =>
      withGameAssetWriteFences(
        writes.map(({ key }) => key),
        async () => {
          try {
            for (const write of writes) {
              await enqueueStorageDeletion(
                prewriteGameAssetDeletionIntent(write),
                {
                  runAt: new Date(Date.now() + PREWRITE_DELETION_DELAY_MS),
                },
              )
            }
            for (const write of writes) {
              await gameAssetStorage.put(
                write.key,
                write.prepared.bytes,
                GAME_ASSET_CONTENT_TYPE,
              )
            }

            const updatedAt = new Date()
            const assetColumns: Partial<typeof game.$inferInsert> = {}
            for (const write of writes) {
              Object.assign(
                assetColumns,
                gameAssetColumns(
                  write.role,
                  write.key,
                  write.prepared,
                  updatedAt,
                ),
              )
            }
            const inserted = await db.transaction(async (tx) => {
              const [row] = await tx
                .insert(game)
                .values({
                  id: gameId,
                  source: "custom",
                  name: input.name,
                  slug: input.slug,
                  release_date: input.releaseDate,
                  updated_at: updatedAt,
                  ...assetColumns,
                })
                .returning({ id: game.id })
              if (!row) return false
              for (const write of writes) {
                await cancelStorageDeletion("assets", write.key, { tx })
              }
              return true
            })
            if (!inserted) return badGamePersistenceResult()
            return loadAdminGame(gameId)
          } catch (cause) {
            wakeAfterWrite = writes.length > 0
            await enqueueGameAssetCleanupNow(writes, "game creation failed")
            throw cause
          }
        },
      ),
    )
  } finally {
    if (wakeAfterWrite) wakeStorageDeletionWorker()
  }
}

type UpdateCustomGameInput = Parameters<typeof urlAssetColumns>[0] & {
  name?: string
  slug?: string
  releaseDate?: string | null
}

async function updateCustomGame(
  gameId: string,
  body: UpdateCustomGameInput,
): Promise<AdminGameResult> {
  const assetColumns = await urlAssetColumns(body)
  const slug =
    body.slug === undefined
      ? undefined
      : await availableCustomGameSlug(body.slug, gameId)
  const hasAssetUpdate = GAME_ASSET_ROLES.some(
    (role) => body[GAME_ASSET_INPUT_COLUMN[role]] !== undefined,
  )

  const mutate = async () => {
    const transactionResult = await db.transaction(async (tx) => {
      const locked = await lockCustomGame(tx, gameId)
      if (!locked) return { result: missingGameResult(), queued: 0 }
      const patch: Partial<typeof game.$inferInsert> = {
        updated_at: new Date(),
        ...assetColumns,
      }
      if (body.name !== undefined) patch.name = body.name
      if (slug !== undefined) patch.slug = slug
      if (body.releaseDate !== undefined) {
        patch.release_date = body.releaseDate
          ? new Date(body.releaseDate)
          : null
      }

      const intents = []
      for (const role of GAME_ASSET_ROLES) {
        const nextUrl = body[GAME_ASSET_INPUT_COLUMN[role]]
        if (nextUrl === undefined) continue
        intents.push(
          ...gameAssetDeletionIntents({
            gameId,
            role,
            previousUrl: locked[GAME_ASSET_URL_COLUMN[role]],
            reason: `${role} URL replaced`,
            source: { type: "game-asset", id: gameId },
            includeLegacyVariant: true,
          }),
        )
      }
      const [updated] = await tx
        .update(game)
        .set(patch)
        .where(eq(game.id, gameId))
        .returning({ id: game.id })
      if (!updated) return { result: badGamePersistenceResult(), queued: 0 }
      // PATCH accepts validated absolute URLs only. They are external and are
      // never allowed to adopt an object from the local game-asset namespace.
      await enqueueGameAssetIntents(tx, intents)
      return { result: null, queued: intents.length }
    })
    return {
      result: transactionResult.result ?? (await loadAdminGame(gameId)),
      queued: transactionResult.queued,
    }
  }
  const transactionResult = hasAssetUpdate
    ? await withGameAssetMutation(gameId, mutate)
    : await mutate()
  if (transactionResult.queued > 0) wakeStorageDeletionWorker()
  return transactionResult.result
}

async function deleteCustomGame(gameId: string): Promise<void> {
  const queued = await withGameAssetMutation(gameId, () =>
    db.transaction(async (tx) => {
      const locked = await lockCustomGame(tx, gameId)
      if (!locked) return 0
      const intents = GAME_ASSET_ROLES.flatMap((role) =>
        gameAssetDeletionIntents({
          gameId,
          role,
          previousUrl: locked[GAME_ASSET_URL_COLUMN[role]],
          reason: "custom game deleted",
          source: { type: "game-asset", id: gameId },
          includeLegacyVariant: true,
        }),
      )
      await enqueueGameAssetIntents(tx, intents)
      // FK cleanup: clip.game_id is set null, game_follow rows cascade.
      await tx.delete(game).where(eq(game.id, gameId))
      return intents.length
    }),
  )
  if (queued > 0) wakeStorageDeletionWorker()
}

async function removeCustomGameAsset(
  gameId: string,
  role: GameAssetRole,
): Promise<AdminGameResult> {
  return withGameAssetMutation(gameId, async () => {
    const transactionResult = await db.transaction(async (tx) => {
      const locked = await lockCustomGame(tx, gameId)
      if (!locked) return { result: missingGameResult(), queued: 0 }
      const intents = gameAssetDeletionIntents({
        gameId,
        role,
        previousUrl: locked[GAME_ASSET_URL_COLUMN[role]],
        reason: `${role} removed`,
        source: { type: "game-asset", id: gameId },
        includeLegacyVariant: true,
      })
      await tx
        .update(game)
        .set(clearedGameAssetColumns(role))
        .where(eq(game.id, gameId))
      await enqueueGameAssetIntents(tx, intents)
      return { result: null, queued: intents.length }
    })
    if (transactionResult.queued > 0) wakeStorageDeletionWorker()
    return transactionResult.result ?? loadAdminGame(gameId)
  })
}

async function uploadGameAsset(
  gameId: string,
  role: GameAssetRole,
  file: File,
): Promise<AdminGameResult> {
  const prepared = await prepareGameAsset(role, file)
  if (!prepared.ok) return prepared

  const attemptId = randomUUID()
  const key = versionedGameAssetKey(gameId, role, attemptId, GAME_ASSET_EXT)
  let wakeAfterWrite = false
  try {
    return await withGameAssetMutation(gameId, () =>
      withStorageObjectWriteActivity("assets", key, async () => {
        await enqueueStorageDeletion(
          prewriteGameAssetDeletionIntent({ key, attemptId }),
          { runAt: new Date(Date.now() + PREWRITE_DELETION_DELAY_MS) },
        )
        try {
          await gameAssetStorage.put(
            key,
            prepared.bytes,
            GAME_ASSET_CONTENT_TYPE,
          )
          const transactionResult = await db.transaction(async (tx) => {
            const locked = await lockCustomGame(tx, gameId)
            if (!locked) {
              await enqueueStorageDeletion(
                prewriteGameAssetDeletionIntent({
                  key,
                  attemptId,
                  reason: "game row missing after asset upload",
                }),
                { tx, runAt: new Date() },
              )
              return { result: missingGameResult(), queued: 1 }
            }
            const previousUrl = locked[GAME_ASSET_URL_COLUMN[role]]
            const updatedAt = new Date()
            const [updated] = await tx
              .update(game)
              .set({
                updated_at: updatedAt,
                ...gameAssetColumns(role, key, prepared, updatedAt),
              })
              .where(eq(game.id, gameId))
              .returning({ id: game.id })
            if (!updated) {
              return { result: badGamePersistenceResult(), queued: 0 }
            }
            await cancelStorageDeletion("assets", key, { tx })
            const intents = gameAssetDeletionIntents({
              gameId,
              role,
              previousUrl,
              retainedKey: key,
              reason: `${role} replaced`,
              source: { type: "game-asset", id: gameId },
              includeLegacyVariant: true,
            })
            await enqueueGameAssetIntents(tx, intents)
            return { result: null, queued: intents.length }
          })
          wakeAfterWrite ||= transactionResult.queued > 0
          return transactionResult.result ?? loadAdminGame(gameId)
        } catch (cause) {
          wakeAfterWrite = true
          await enqueueGameAssetCleanupNow(
            [{ key, attemptId }],
            "game asset upload failed",
          )
          throw cause
        }
      }),
    )
  } finally {
    if (wakeAfterWrite) wakeStorageDeletionWorker()
  }
}

function badGamePersistenceResult(): AdminGameResult {
  return { ok: false, status: 500, error: "Game did not persist" }
}

function withGameAssetWriteFences<T>(
  keys: readonly string[],
  operation: () => Promise<T>,
  index = 0,
): Promise<T> {
  const key = keys[index]
  return key
    ? withStorageObjectWriteActivity("assets", key, () =>
        withGameAssetWriteFences(keys, operation, index + 1),
      )
    : operation()
}

async function enqueueGameAssetCleanupNow(
  writes: readonly { key: string; attemptId: string }[],
  reason: string,
): Promise<void> {
  if (writes.length === 0) return
  await db.transaction(async (tx) => {
    for (const write of writes) {
      await enqueueStorageDeletion(
        prewriteGameAssetDeletionIntent({ ...write, reason }),
        { tx, runAt: new Date() },
      )
    }
  })
}
