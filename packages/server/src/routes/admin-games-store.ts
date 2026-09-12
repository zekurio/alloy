import { randomUUID } from "node:crypto"

import {
  GAME_ASSET_ROLES,
  type AdminGameRow,
  type GameAssetRole,
} from "@alloy/contracts"
import { clip, game } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { withGameAssetMutation } from "@alloy/server/games/game-asset-activity"
import { gameAssetDeletionIntents } from "@alloy/server/games/game-asset-deletion"
import {
  availableCustomGameSlug,
  gameSelection,
  serialiseGameRow,
} from "@alloy/server/games/ref"
import { badRequest, notFound } from "@alloy/server/runtime/http-response"
import { prewriteAssetDeletionIntent } from "@alloy/server/storage/deletion-producers"
import {
  cancelStorageDeletion,
  enqueueStorageDeletion,
  enqueueStorageDeletions,
} from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { assetStorage, versionedAssetKey } from "@alloy/server/storage/index"
import { withStorageObjectWriteActivity } from "@alloy/server/storage/write-activity"
import { eq, getTableColumns, sql } from "drizzle-orm"
import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import {
  clearedGameAssetColumns,
  enqueueGameAssetCleanupNow,
  GAME_ASSET_CONTENT_TYPE,
  GAME_ASSET_URL_COLUMN,
  gameAssetColumns,
  prepareGameAsset,
  type PreparedGameAsset,
  urlAssetColumns,
  withGameAssetWriteFences,
} from "./admin-game-assets"

const PREWRITE_DELETION_DELAY_MS = 60 * 1000
const GAME_ASSET_INPUT_COLUMN = {
  hero: "heroUrl",
  grid: "gridUrl",
  logo: "logoUrl",
  icon: "iconUrl",
} as const

export async function selectCustomGame(
  c: Context,
  gameId: string,
): Promise<{ row: { id: string } } | { response: Response }> {
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

const missingGameResult = (): AdminGameResult => ({
  ok: false,
  status: 404,
  error: "Unknown game",
})

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

export async function createCustomGame(input: {
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
      key: versionedAssetKey(gameId, asset.role, attemptId),
    }
  })
  let wakeAfterWrite = false
  try {
    return await withGameAssetMutation(gameId, () =>
      withGameAssetWriteFences(
        writes.map(({ key }) => key),
        async () => {
          try {
            await enqueueStorageDeletions(
              writes.map(prewriteAssetDeletionIntent),
              { runAt: new Date(Date.now() + PREWRITE_DELETION_DELAY_MS) },
            )
            for (const write of writes) {
              await assetStorage.put(
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

export async function updateCustomGame(
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
          }),
        )
      }
      const [updated] = await tx
        .update(game)
        .set(patch)
        .where(eq(game.id, gameId))
        .returning({ id: game.id })
      if (!updated) return { result: badGamePersistenceResult(), queued: 0 }
      await enqueueStorageDeletions(intents, { tx })
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

export async function deleteCustomGame(gameId: string): Promise<void> {
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
        }),
      )
      await enqueueStorageDeletions(intents, { tx })
      await tx.delete(game).where(eq(game.id, gameId))
      return intents.length
    }),
  )
  if (queued > 0) wakeStorageDeletionWorker()
}

export async function removeCustomGameAsset(
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
      })
      await tx
        .update(game)
        .set(clearedGameAssetColumns(role))
        .where(eq(game.id, gameId))
      await enqueueStorageDeletions(intents, { tx })
      return { result: null, queued: intents.length }
    })
    if (transactionResult.queued > 0) wakeStorageDeletionWorker()
    return transactionResult.result ?? loadAdminGame(gameId)
  })
}

export async function uploadGameAsset(
  gameId: string,
  role: GameAssetRole,
  file: File,
): Promise<AdminGameResult> {
  const prepared = await prepareGameAsset(role, file)
  if (!prepared.ok) return prepared

  const attemptId = randomUUID()
  const key = versionedAssetKey(gameId, role, attemptId)
  let wakeAfterWrite = false
  try {
    return await withGameAssetMutation(gameId, () =>
      withStorageObjectWriteActivity("assets", key, async () => {
        await enqueueStorageDeletion(
          prewriteAssetDeletionIntent({ key, attemptId }),
          { runAt: new Date(Date.now() + PREWRITE_DELETION_DELAY_MS) },
        )
        try {
          await assetStorage.put(key, prepared.bytes, GAME_ASSET_CONTENT_TYPE)
          const transactionResult = await db.transaction(async (tx) => {
            const locked = await lockCustomGame(tx, gameId)
            if (!locked) {
              await enqueueStorageDeletion(
                prewriteAssetDeletionIntent({
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
            })
            await enqueueStorageDeletions(intents, { tx })
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

const badGamePersistenceResult = (): AdminGameResult => ({
  ok: false,
  status: 500,
  error: "Game did not persist",
})
