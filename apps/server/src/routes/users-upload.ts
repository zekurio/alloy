import { Readable } from "node:stream"

import { zValidator } from "@hono/zod-validator"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { user } from "@workspace/db/auth-schema"
import { ACCEPTED_IMAGE_CONTENT_TYPES } from "@workspace/contracts"

import { db } from "../db"
import { requireSession } from "../auth/require-session"
import { validateImageBytes } from "../media/image-validation"
import { storage, userAssetKey } from "../storage"
import type { ResolvedObject } from "../storage/driver"
import { toPublicUser, type UserRow } from "./users-helpers"

const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_BANNER_BYTES = 10 * 1024 * 1024 // 10 MB
const USER_ASSET_CONTENT_TYPE = "image/webp"
const USER_ASSET_EXT = ".webp"

const USER_ASSET_TARGETS = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1500, height: 375 },
} as const

const EXT_FOR_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
}

const UploadBody = z.object({
  data: z.string().min(1),
  contentType: z.enum(ACCEPTED_IMAGE_CONTENT_TYPES),
})

async function readAll(node: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of node) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function assetUrl(key: string, updatedAt: Date): string {
  return `/api/assets/users/${key}?v=${updatedAt.getTime().toString(36)}`
}

function assetEtag(key: string, resolved: ResolvedObject): string {
  const modified = resolved.lastModified?.getTime() ?? 0
  return `"${Buffer.from(`${key}:${resolved.size}:${modified}`).toString("base64url")}"`
}

async function fetchRow(userId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  return row ?? null
}

async function deleteOldAssets(
  userId: string,
  role: "avatar" | "banner"
): Promise<void> {
  const exts = [
    ...new Set([...Object.values(EXT_FOR_CONTENT_TYPE), USER_ASSET_EXT]),
  ]
  await Promise.all(
    exts.map((ext) => storage.delete(userAssetKey(userId, role, ext)))
  )
}

function imageMagickArgs(
  target: (typeof USER_ASSET_TARGETS)["avatar" | "banner"]
): string[] {
  const magick = globalThis.Bun.which("magick")
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

  const convert = globalThis.Bun.which("convert")
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
  role: "avatar" | "banner"
): Promise<Buffer> {
  const target = USER_ASSET_TARGETS[role]
  const child = globalThis.Bun.spawn(imageMagickArgs(target), {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  child.stdin.write(bytes)
  child.stdin.end()
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || "ImageMagick failed")
  }
  return Buffer.from(stdout)
}

export const usersUploadRoute = new Hono<{
  Variables: { viewerId: string }
}>()
  .post(
    "/me/avatar/upload",
    requireSession,
    zValidator("json", UploadBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { data, contentType } = c.req.valid("json")

      const buf = Buffer.from(data, "base64")
      if (buf.byteLength === 0) {
        return c.json({ error: "Empty image data" }, 400)
      }
      if (buf.byteLength > MAX_AVATAR_BYTES) {
        return c.json(
          {
            error: `Avatar too large. Max ${MAX_AVATAR_BYTES / 1024 / 1024} MB`,
          },
          413
        )
      }
      const validation = validateImageBytes(buf, contentType)
      if (!validation.ok) {
        return c.json({ error: validation.error }, 400)
      }

      let resized: Buffer
      try {
        resized = await resizeUserAsset(buf, "avatar")
      } catch (cause) {
        console.error("Failed to process avatar upload", cause)
        return c.json({ error: "Could not process image" }, 400)
      }

      const key = userAssetKey(viewerId, "avatar", USER_ASSET_EXT)

      await deleteOldAssets(viewerId, "avatar")
      await storage.put(key, resized, USER_ASSET_CONTENT_TYPE)

      const updatedAt = new Date()
      const url = assetUrl(key, updatedAt)
      await db
        .update(user)
        .set({ image: url, updatedAt })
        .where(eq(user.id, viewerId))

      const row = await fetchRow(viewerId)
      return c.json(toPublicUser(row!))
    }
  )

  .post(
    "/me/banner/upload",
    requireSession,
    zValidator("json", UploadBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { data, contentType } = c.req.valid("json")

      const buf = Buffer.from(data, "base64")
      if (buf.byteLength === 0) {
        return c.json({ error: "Empty image data" }, 400)
      }
      if (buf.byteLength > MAX_BANNER_BYTES) {
        return c.json(
          {
            error: `Banner too large. Max ${MAX_BANNER_BYTES / 1024 / 1024} MB`,
          },
          413
        )
      }
      const validation = validateImageBytes(buf, contentType)
      if (!validation.ok) {
        return c.json({ error: validation.error }, 400)
      }

      let resized: Buffer
      try {
        resized = await resizeUserAsset(buf, "banner")
      } catch (cause) {
        console.error("Failed to process banner upload", cause)
        return c.json({ error: "Could not process image" }, 400)
      }

      const key = userAssetKey(viewerId, "banner", USER_ASSET_EXT)

      await deleteOldAssets(viewerId, "banner")
      await storage.put(key, resized, USER_ASSET_CONTENT_TYPE)

      const updatedAt = new Date()
      const url = assetUrl(key, updatedAt)
      await db
        .update(user)
        .set({ banner: url, updatedAt })
        .where(eq(user.id, viewerId))

      const row = await fetchRow(viewerId)
      return c.json(toPublicUser(row!))
    }
  )

  .delete("/me/avatar", requireSession, async (c) => {
    const viewerId = c.var.viewerId
    await deleteOldAssets(viewerId, "avatar")
    await db
      .update(user)
      .set({ image: null, updatedAt: new Date() })
      .where(eq(user.id, viewerId))
    const row = await fetchRow(viewerId)
    return c.json(toPublicUser(row!))
  })

  .delete("/me/banner", requireSession, async (c) => {
    const viewerId = c.var.viewerId
    await deleteOldAssets(viewerId, "banner")
    await db
      .update(user)
      .set({ banner: null, updatedAt: new Date() })
      .where(eq(user.id, viewerId))
    const row = await fetchRow(viewerId)
    return c.json(toPublicUser(row!))
  })

export const userAssetsRoute = new Hono().get("/:key{.+}", async (c) => {
  const key = c.req.param("key") ?? ""
  if (!key) return c.json({ error: "Not found" }, 404)

  const direct = await storage.mintDownloadUrl(key, {
    expiresInSec: 900,
    responseCacheControl: "public, max-age=86400, immutable",
  })
  if (direct) {
    c.header("Cache-Control", "public, max-age=60")
    return c.redirect(direct.url, 302)
  }

  const resolved = await storage.resolve(key)
  if (!resolved) return c.json({ error: "Not found" }, 404)
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
