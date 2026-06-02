import { zValidator } from "./validation"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { Buffer } from "node:buffer"
import { z } from "zod"

import { user } from "@workspace/db/auth-schema"
import {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  userAssetImagePath,
} from "@workspace/contracts"
import { logger } from "@workspace/logging"

import { db } from "../db"
import { requireSession } from "../auth/require-session"
import { validateImageBytes } from "../media/image-validation"
import { errorResult, notFound } from "../runtime/http-response"
import { storage, userAssetKey } from "../storage"
import type { ResolvedObject } from "../storage/driver"
import { toPublicUser, type UserRow } from "./users-helpers"

type UserAssetRole = "avatar" | "banner"
type UserAssetUploadBody = {
  data: string
  contentType: (typeof ACCEPTED_IMAGE_CONTENT_TYPES)[number]
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_BANNER_BYTES = 10 * 1024 * 1024 // 10 MB
const USER_ASSET_CONTENT_TYPE = "image/webp"
const USER_ASSET_EXT = ".webp"
const BASE64_OVERHEAD = 4 / 3
const MAX_AVATAR_DATA_CHARS = Math.ceil(MAX_AVATAR_BYTES * BASE64_OVERHEAD) + 4
const MAX_BANNER_DATA_CHARS = Math.ceil(MAX_BANNER_BYTES * BASE64_OVERHEAD) + 4
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

const AvatarUploadBody = z.object({
  data: z.string().min(1).max(MAX_AVATAR_DATA_CHARS),
  contentType: z.enum(ACCEPTED_IMAGE_CONTENT_TYPES),
})

const BannerUploadBody = z.object({
  data: z.string().min(1).max(MAX_BANNER_DATA_CHARS),
  contentType: z.enum(ACCEPTED_IMAGE_CONTENT_TYPES),
})

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
  return `"${Buffer.from(`${key}:${resolved.size}:${modified}`).toString("base64url")}"`
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
  role: UserAssetRole
): Promise<void> {
  const exts = [
    ...new Set([...Object.values(EXT_FOR_CONTENT_TYPE), USER_ASSET_EXT]),
  ]
  await Promise.all(
    exts.map((ext) => storage.delete(userAssetKey(userId, role, ext)))
  )
}

async function which(binary: string): Promise<string | null> {
  const command = new Deno.Command("which", {
    args: [binary],
    stdout: "piped",
    stderr: "null",
  })
  const output = await command.output()
  if (!output.success) return null
  const path = new TextDecoder().decode(output.stdout).trim()
  return path.length > 0 ? path : null
}

async function imageMagickArgs(
  target: (typeof USER_ASSET_TARGETS)[UserAssetRole]
): Promise<string[]> {
  const magick = await which("magick")
  if (magick) {
    return [
      magick,
      "-",
      "-auto-orient",
      "-resize",
      `${target.width}x${target.height}!`,
      "webp:-",
    ]
  }

  const convert = await which("convert")
  if (convert) {
    return [
      convert,
      "-",
      "-auto-orient",
      "-resize",
      `${target.width}x${target.height}!`,
      "webp:-",
    ]
  }

  throw new Error("ImageMagick is not installed")
}

async function resizeUserAsset(
  bytes: Buffer,
  role: UserAssetRole
): Promise<Buffer> {
  const target = USER_ASSET_TARGETS[role]
  const [command, ...args] = await imageMagickArgs(target)
  const child = new Deno.Command(command, {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  })
  const process = child.spawn()
  const writer = process.stdin.getWriter()
  await writer.write(bytes)
  await writer.close()
  const { stdout, stderr, success } = await process.output()
  if (!success) {
    const message = new TextDecoder().decode(stderr).trim()
    throw new Error(message || "ImageMagick failed")
  }
  return Buffer.from(stdout)
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
  data: string
  contentType: string
}): Promise<UserAssetUpdateResult> {
  const limit = USER_ASSET_LIMITS[input.role]
  const buf = Buffer.from(input.data, "base64")
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
      cause
    )
    return { ok: false, status: 400, error: "Could not process image" }
  }

  const key = userAssetKey(input.viewerId, input.role, USER_ASSET_EXT)
  await deleteOldAssets(input.viewerId, input.role)
  await storage.put(key, resized, USER_ASSET_CONTENT_TYPE)

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
  role: UserAssetRole
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
  body: UserAssetUploadBody
) {
  const result = await uploadUserAsset({
    viewerId,
    role,
    data: body.data,
    contentType: body.contentType,
  })
  return result
}

export const usersUploadRoute = new Hono<{
  Variables: { viewerId: string }
}>()
  .post(
    "/me/avatar/upload",
    requireSession,
    zValidator("json", AvatarUploadBody),
    async (c) => {
      const result = await uploadUserAssetResponse(
        c.var.viewerId,
        "avatar",
        c.req.valid("json")
      )
      return result.ok ? c.json(result.user) : errorResult(c, result)
    }
  )

  .post(
    "/me/banner/upload",
    requireSession,
    zValidator("json", BannerUploadBody),
    async (c) => {
      const result = await uploadUserAssetResponse(
        c.var.viewerId,
        "banner",
        c.req.valid("json")
      )
      return result.ok ? c.json(result.user) : errorResult(c, result)
    }
  )

  .delete("/me/avatar", requireSession, async (c) => {
    const result = await removeUserAsset(c.var.viewerId, "avatar")
    return result.ok ? c.json(result.user) : errorResult(c, result)
  })

  .delete("/me/banner", requireSession, async (c) => {
    const result = await removeUserAsset(c.var.viewerId, "banner")
    return result.ok ? c.json(result.user) : errorResult(c, result)
  })

export const userAssetsRoute = new Hono().get("/:key{.+}", async (c) => {
  const key = c.req.param("key") ?? ""
  if (!key || !USER_ASSET_KEY_RE.test(key)) {
    return notFound(c)
  }

  const direct = await storage.mintDownloadUrl(key, {
    expiresInSec: 900,
    responseCacheControl: "public, max-age=86400, immutable",
  })
  if (direct) {
    c.header("Cache-Control", "public, max-age=60")
    return c.redirect(direct.url, 302)
  }

  const resolved = await storage.resolve(key)
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
      buf.byteOffset + buf.byteLength
    ) as ArrayBuffer
  )
})
