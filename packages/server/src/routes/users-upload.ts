import { Buffer } from "node:buffer"

import { userAssetImagePath } from "alloy-contracts"
import { user } from "alloy-db/auth-schema"
import { logger } from "alloy-logging"
import { eq } from "drizzle-orm"
import { type Context, Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { z } from "zod"

import { requireSession } from "../auth/require-session"
import { db } from "../db"
import { validateImageBytes } from "../media/image-validation"
import { runImageMagick } from "../media/imagemagick"
import { errorResult, notFound } from "../runtime/http-response"
import { dataStorage, userAssetKey } from "../storage"
import type { ResolvedObject } from "../storage/driver"
import { toPublicUser, type UserRow } from "./users-helpers"
import { zValidator } from "./validation"

type UserAssetRole = "avatar" | "banner"

const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_BANNER_BYTES = 10 * 1024 * 1024 // 10 MB
const USER_ASSET_CONTENT_TYPE = "image/webp"
const USER_ASSET_EXT = ".webp"
const USER_ASSET_KEY_RE =
  /^users\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:avatar|banner)\.webp$/i

const USER_ASSET_TARGETS = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1500, height: 375 },
} as const

const USER_ASSET_LIMITS: Record<
  UserAssetRole,
  { label: string; maxBytes: number }
> = {
  avatar: { label: "Avatar", maxBytes: MAX_AVATAR_BYTES },
  banner: { label: "Banner", maxBytes: MAX_BANNER_BYTES },
}

const EXT_FOR_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
}

const UserAssetUploadForm = z.object({
  file: z.instanceof(File, { message: "Expected an uploaded image file" }),
})

function validateUserAssetFile(
  role: UserAssetRole,
  file: File,
): UserAssetUpdateResult | null {
  const limit = USER_ASSET_LIMITS[role]
  if (file.size === 0) {
    return { ok: false, status: 400, error: "Empty image data" }
  }
  if (file.size > limit.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `${limit.label} too large. Max ${limit.maxBytes / 1024 / 1024} MB`,
    }
  }
  if (!Object.hasOwn(EXT_FOR_CONTENT_TYPE, file.type)) {
    return { ok: false, status: 400, error: "Unsupported image type" }
  }
  return null
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

function assetEtag(key: string, resolved: ResolvedObject): string {
  const modified = resolved.lastModified?.getTime() ?? 0
  return `"${Buffer.from(`${key}:${resolved.size}:${modified}`).toString(
    "base64url",
  )}"`
}

async function fetchRow(userId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  return row ?? null
}

async function fetchUpdatedPublicUser(userId: string) {
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
    exts.map((ext) => dataStorage.delete(userAssetKey(userId, role, ext))),
  )
}

async function resizeUserAsset(
  bytes: Buffer,
  role: UserAssetRole,
): Promise<Buffer> {
  const target = USER_ASSET_TARGETS[role]
  return await runImageMagick(
    [
      "-",
      "-auto-orient",
      "-resize",
      `${target.width}x${target.height}!`,
      "webp:-",
    ],
    bytes,
  )
}

type UserAssetUpdateResult =
  | {
      ok: true
      user: NonNullable<Awaited<ReturnType<typeof fetchUpdatedPublicUser>>>
    }
  | { ok: false; status: 400 | 413 | 500; error: string }

async function uploadUserAsset(input: {
  viewerId: string
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
    logger.error(
      `[users/upload] failed to process ${input.role} upload:`,
      cause,
    )
    return { ok: false, status: 400, error: "Could not process image" }
  }

  const key = userAssetKey(input.viewerId, input.role, USER_ASSET_EXT)
  await deleteOldAssets(input.viewerId, input.role)
  await dataStorage.put(key, resized, USER_ASSET_CONTENT_TYPE)

  const updatedAt = new Date()
  const patch: Partial<typeof user.$inferInsert> = { updatedAt }
  if (input.role === "avatar") {
    patch.image = userAssetImagePath(key, updatedAt)
  } else {
    patch.banner = userAssetImagePath(key, updatedAt)
  }

  await db.update(user).set(patch).where(eq(user.id, input.viewerId))

  const updated = await fetchUpdatedPublicUser(input.viewerId)
  if (!updated) {
    return { ok: false, status: 500, error: "User update did not persist" }
  }
  return { ok: true, user: updated }
}

async function removeUserAsset(
  viewerId: string,
  role: UserAssetRole,
): Promise<UserAssetUpdateResult> {
  await deleteOldAssets(viewerId, role)
  const patch: Partial<typeof user.$inferInsert> = { updatedAt: new Date() }
  if (role === "avatar") {
    patch.image = null
  } else {
    patch.banner = null
  }
  await db.update(user).set(patch).where(eq(user.id, viewerId))

  const updated = await fetchUpdatedPublicUser(viewerId)
  if (!updated) {
    return { ok: false, status: 500, error: "User update did not persist" }
  }
  return { ok: true, user: updated }
}

async function uploadUserAssetResponse(
  viewerId: string,
  role: UserAssetRole,
  file: File,
) {
  const invalid = validateUserAssetFile(role, file)
  if (invalid) return invalid

  const bytes = new Uint8Array(await file.arrayBuffer())
  return uploadUserAsset({
    viewerId,
    role,
    bytes,
    contentType: file.type,
  })
}

type UserAssetMutation<U> =
  | { ok: true; user: U }
  | { ok: false; error: string; status: ContentfulStatusCode }

async function respondUserAsset<U>(
  c: Context,
  pending: Promise<UserAssetMutation<U>>,
) {
  const result = await pending
  return result.ok ? c.json(result.user) : errorResult(c, result)
}

function respondUploadedUserAsset(
  c: Context,
  viewerId: string,
  role: UserAssetRole,
  file: File,
) {
  return respondUserAsset(c, uploadUserAssetResponse(viewerId, role, file))
}

export const usersUploadRoute = new Hono<{
  Variables: { viewerId: string }
}>()
  .post(
    "/me/avatar/upload",
    requireSession,
    zValidator("form", UserAssetUploadForm),
    (c) => {
      const { file } = c.req.valid("form")
      return respondUploadedUserAsset(c, c.var.viewerId, "avatar", file)
    },
  )
  .post(
    "/me/banner/upload",
    requireSession,
    zValidator("form", UserAssetUploadForm),
    (c) =>
      respondUploadedUserAsset(
        c,
        c.var.viewerId,
        "banner",
        c.req.valid("form").file,
      ),
  )
  .delete("/me/avatar", requireSession, (c) =>
    respondUserAsset(c, removeUserAsset(c.var.viewerId, "avatar")),
  )
  .delete("/me/banner", requireSession, (c) =>
    respondUserAsset(c, removeUserAsset(c.var.viewerId, "banner")),
  )

export const userAssetsRoute = new Hono().get("/:key{.+}", async (c) => {
  const key = c.req.param("key") ?? ""
  if (!key || !USER_ASSET_KEY_RE.test(key)) {
    return notFound(c)
  }

  const resolved = await dataStorage.resolve(key)
  if (!resolved) return notFound(c)
  const etag = assetEtag(key, resolved)

  c.header("ETag", etag)
  if (resolved.lastModified) {
    c.header("Last-Modified", resolved.lastModified.toUTCString())
  }
  c.header("Cache-Control", "public, max-age=86400, immutable")

  if (
    c.req
      .header("if-none-match")
      ?.split(",")
      .map((v) => v.trim())
      .includes(etag)
  ) {
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
