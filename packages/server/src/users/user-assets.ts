import { userAssetImagePath, type PublicUser } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { createLogger } from "@alloy/logging"
import { db } from "@alloy/server/db/index"
import { validateImageBytes } from "@alloy/server/media/image-validation"
import type { UserAssetRole } from "@alloy/server/storage/driver"
import { userAssetKey, userStorage } from "@alloy/server/storage/index"
import { eq } from "drizzle-orm"
import sharp from "sharp"

import { toPublicUser, type UserRow } from "../routes/users-helpers"

const logger = createLogger("users")

const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_BANNER_BYTES = 10 * 1024 * 1024 // 10 MB
const USER_ASSET_CONTENT_TYPE = "image/webp"
const USER_ASSET_EXT = ".webp"
const USER_ASSET_TARGETS = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1500, height: 375 },
} as const

// Maps each asset role to the `user` column that stores its public path.
const USER_ASSET_COLUMN: Record<UserAssetRole, "image" | "banner"> = {
  avatar: "image",
  banner: "banner",
}

export const USER_ASSET_LIMITS: Record<
  UserAssetRole,
  { label: string; maxBytes: number }
> = {
  avatar: { label: "Avatar", maxBytes: MAX_AVATAR_BYTES },
  banner: { label: "Banner", maxBytes: MAX_BANNER_BYTES },
}

export const EXT_FOR_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
}

export type UserAssetUpdateResult =
  | {
      ok: true
      user: PublicUser
    }
  | { ok: false; status: 400 | 413 | 500; error: string }

async function fetchRow(userId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  return row ?? null
}

async function fetchUpdatedPublicUser(
  userId: string,
): Promise<PublicUser | null> {
  const row = await fetchRow(userId)
  return row ? toPublicUser(row) : null
}

async function deleteOldAssets(
  userId: string,
  role: UserAssetRole,
): Promise<void> {
  const exts = [
    ...new Set([...Object.values(EXT_FOR_CONTENT_TYPE), USER_ASSET_EXT]),
  ]
  await Promise.all(
    exts.map((ext) => userStorage.delete(userAssetKey(userId, role, ext))),
  )
}

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

  const key = userAssetKey(input.userId, input.role, USER_ASSET_EXT)
  await deleteOldAssets(input.userId, input.role)
  await userStorage.put(key, resized, USER_ASSET_CONTENT_TYPE)

  const updatedAt = new Date()
  const patch: Partial<typeof user.$inferInsert> = { updated_at: updatedAt }
  patch[USER_ASSET_COLUMN[input.role]] = userAssetImagePath(key, updatedAt)

  await db.update(user).set(patch).where(eq(user.id, input.userId))

  const updated = await fetchUpdatedPublicUser(input.userId)
  if (!updated) {
    return { ok: false, status: 500, error: "User update did not persist" }
  }
  return { ok: true, user: updated }
}

export async function removeUserAsset(
  viewerId: string,
  role: UserAssetRole,
): Promise<UserAssetUpdateResult> {
  await deleteOldAssets(viewerId, role)
  const patch: Partial<typeof user.$inferInsert> = { updated_at: new Date() }
  patch[USER_ASSET_COLUMN[role]] = null
  await db.update(user).set(patch).where(eq(user.id, viewerId))

  const updated = await fetchUpdatedPublicUser(viewerId)
  if (!updated) {
    return { ok: false, status: 500, error: "User update did not persist" }
  }
  return { ok: true, user: updated }
}
