import { randomUUID } from "node:crypto"

import { userAssetImagePath, type PublicUser } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { validateImageBytes } from "@alloy/server/media/image-validation"
import { prewriteAssetDeletionIntent } from "@alloy/server/storage/deletion-producers"
import {
  cancelStorageDeletion,
  enqueueStorageDeletion,
  enqueueStorageDeletions,
} from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import type { UserAssetRole } from "@alloy/server/storage/driver"
import { userStorage, versionedAssetKey } from "@alloy/server/storage/index"
import { withStorageObjectWriteActivity } from "@alloy/server/storage/write-activity"
import { eq, getTableColumns, sql } from "drizzle-orm"
import sharp from "sharp"

import { toPublicUser } from "../routes/users-helpers"
import {
  userAssetConditionalUploadMatches,
  userAssetDeletionIntents,
} from "./user-asset-deletion"

const logger = createLogger("users")

const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_BANNER_BYTES = 10 * 1024 * 1024 // 10 MB
const USER_ASSET_CONTENT_TYPE = "image/webp"
// The active-write fence provides correctness. This short delay merely avoids
// waking the worker during the normal small-image upload/attach path.
const PREWRITE_DELETION_DELAY_MS = 60 * 1000
const USER_ASSET_TARGETS = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1500, height: 375 },
} as const

// Maps each asset role to the `user` column that stores its public path.
const USER_ASSET_COLUMN = {
  avatar: "image",
  banner: "banner",
} satisfies Record<UserAssetRole, "image" | "banner">

export const USER_ASSET_LIMITS = {
  avatar: { label: "Avatar", maxBytes: MAX_AVATAR_BYTES },
  banner: { label: "Banner", maxBytes: MAX_BANNER_BYTES },
} satisfies Record<UserAssetRole, { label: string; maxBytes: number }>

export const EXT_FOR_CONTENT_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} satisfies Record<string, string>

export type UserAssetUpdateResult =
  | {
      ok: true
      user: PublicUser
    }
  | { ok: false; status: 400 | 413 | 500; error: string }

async function resizeUserAsset(
  bytes: Buffer,
  role: UserAssetRole,
): Promise<Buffer> {
  const target = USER_ASSET_TARGETS[role]
  // rotate() with no angle applies the EXIF orientation; "fill" matches the
  // old ImageMagick `WxH!` forced-exact resize.
  return await sharp(bytes)
    .rotate()
    .resize(target.width, target.height, { fit: "fill" })
    .webp()
    .toBuffer()
}

export async function uploadUserAsset(input: {
  userId: string
  role: UserAssetRole
  bytes: Uint8Array
  contentType: string
  expected?: {
    currentUrl: string | null
    revision: string
  }
}): Promise<UserAssetUpdateResult> {
  const limit = USER_ASSET_LIMITS[input.role]
  const buf = Buffer.from(input.bytes)
  if (buf.byteLength === 0) {
    return { ok: false, status: 400, error: "Empty image data" }
  }
  if (buf.byteLength > limit.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `${limit.label} too large. Max ${limit.maxBytes / 1024 / 1024} MB`,
    }
  }

  const validation = validateImageBytes(buf, input.contentType)
  if (!validation.ok) {
    return { ok: false, status: 400, error: validation.error }
  }

  let resized: Buffer
  try {
    resized = await resizeUserAsset(buf, input.role)
  } catch (cause) {
    logger.error(`failed to process ${input.role} upload:`, cause)
    return { ok: false, status: 400, error: "Could not process image" }
  }

  const attemptId = randomUUID()
  const key = versionedAssetKey(input.userId, input.role, attemptId)
  let wakeAfterWrite = false
  try {
    return await withStorageObjectWriteActivity("assets", key, async () => {
      await enqueueStorageDeletion(
        prewriteAssetDeletionIntent({ key, attemptId }),
        { runAt: new Date(Date.now() + PREWRITE_DELETION_DELAY_MS) },
      )

      let cleanupReason = "user asset upload failed"
      try {
        await userStorage.put(key, resized, USER_ASSET_CONTENT_TYPE)
        cleanupReason = "user asset swap failed"
        const transactionResult = await db.transaction(
          async (
            tx,
          ): Promise<{
            result: UserAssetUpdateResult
            queuedDeletions: number
          }> => {
            const [locked] = await tx
              .select({
                row: getTableColumns(user),
                revision: sql<string>`${user.updated_at}::text`,
              })
              .from(user)
              .where(eq(user.id, input.userId))
              .limit(1)
              .for("update")
            if (!locked) {
              await enqueueStorageDeletion(
                prewriteAssetDeletionIntent({
                  key,
                  reason: "user row missing after asset upload",
                  attemptId,
                }),
                { tx },
              )
              return {
                result: missingUserResult(),
                queuedDeletions: 1,
              }
            }

            const column = USER_ASSET_COLUMN[input.role]
            if (
              !userAssetConditionalUploadMatches(
                locked.row[column],
                locked.revision,
                input.expected,
              )
            ) {
              await enqueueStorageDeletion(
                prewriteAssetDeletionIntent({
                  key,
                  reason: "conditional user asset upload rejected",
                  attemptId,
                }),
                { tx },
              )
              return {
                result: { ok: true, user: toPublicUser(locked.row) },
                queuedDeletions: 1,
              }
            }

            const previousUrl = locked.row[column]
            const updatedAt = new Date()
            const patch: Partial<typeof user.$inferInsert> = {
              updated_at: updatedAt,
            }
            patch[column] = userAssetImagePath(key, updatedAt)
            const [updated] = await tx
              .update(user)
              .set(patch)
              .where(eq(user.id, input.userId))
              .returning()
            if (!updated) {
              await enqueueStorageDeletion(
                prewriteAssetDeletionIntent({
                  key,
                  reason: "user asset update rejected",
                  attemptId,
                }),
                { tx },
              )
              return {
                result: missingUserResult(),
                queuedDeletions: 1,
              }
            }

            // The pointer and reservation change atomically. An uncertain commit
            // is still safe: re-enqueueing below is blocked by the live reference.
            await cancelStorageDeletion("assets", key, { tx })
            const displaced = userAssetDeletionIntents({
              userId: input.userId,
              role: input.role,
              previousUrl,
              retainedKey: key,
              reason: `${input.role} replaced`,
              source: { type: "user-asset", id: input.userId },
            })
            await enqueueStorageDeletions(displaced, { tx })
            return {
              result: { ok: true, user: toPublicUser(updated) },
              queuedDeletions: displaced.length,
            }
          },
        )
        wakeAfterWrite ||= transactionResult.queuedDeletions > 0
        return transactionResult.result
      } catch (cause) {
        wakeAfterWrite = true
        await enqueueUserAssetCleanupNow({
          key,
          reason: cleanupReason,
          attemptId,
        })
        throw cause
      }
    })
  } finally {
    // Never wake an immediately-due cleanup until its writer fence is gone.
    if (wakeAfterWrite) wakeStorageDeletionWorker()
  }
}

export async function removeUserAsset(
  viewerId: string,
  role: UserAssetRole,
): Promise<UserAssetUpdateResult> {
  const transactionResult = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ row: getTableColumns(user) })
      .from(user)
      .where(eq(user.id, viewerId))
      .limit(1)
      .for("update")
    if (!locked) return { result: missingUserResult(), queuedDeletions: 0 }

    const column = USER_ASSET_COLUMN[role]
    const previousUrl = locked.row[column]
    const patch: Partial<typeof user.$inferInsert> = { updated_at: new Date() }
    patch[column] = null
    const [updated] = await tx
      .update(user)
      .set(patch)
      .where(eq(user.id, viewerId))
      .returning()
    if (!updated) return { result: missingUserResult(), queuedDeletions: 0 }

    const intents = userAssetDeletionIntents({
      userId: viewerId,
      role,
      previousUrl,
      reason: `${role} removed`,
      source: { type: "user-asset", id: viewerId },
    })
    await enqueueStorageDeletions(intents, { tx })
    return {
      result: { ok: true, user: toPublicUser(updated) } as const,
      queuedDeletions: intents.length,
    }
  })
  if (transactionResult.queuedDeletions > 0) wakeStorageDeletionWorker()
  return transactionResult.result
}

function missingUserResult(): UserAssetUpdateResult {
  return { ok: false, status: 500, error: "User update did not persist" }
}

async function enqueueUserAssetCleanupNow(input: {
  key: string
  reason: string
  attemptId: string
}): Promise<void> {
  await db.transaction(async (tx) => {
    await enqueueStorageDeletion(prewriteAssetDeletionIntent(input), {
      tx,
      runAt: new Date(),
    })
  })
}
