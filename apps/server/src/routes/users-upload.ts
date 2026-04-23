import { Readable } from "node:stream"

import { zValidator } from "@hono/zod-validator"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { z } from "zod"

import { user } from "@workspace/db/auth-schema"
import { ACCEPTED_IMAGE_CONTENT_TYPES } from "@workspace/db/contracts"

import { db } from "../db"
import { requireSession } from "../lib/require-session"
import { storage, userAssetKey } from "../storage"
import { toPublicUser, type UserRow } from "./users-helpers"

const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_BANNER_BYTES = 10 * 1024 * 1024 // 10 MB

const EXT_FOR_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
}

const UploadBody = z.object({
  data: z.string().min(1),
  contentType: z.enum(ACCEPTED_IMAGE_CONTENT_TYPES),
})

function nodeToWeb(node: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(node) as ReadableStream<Uint8Array>
}

async function readAll(node: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of node) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function assetUrl(key: string, updatedAt: Date): string {
  return `/storage/user-assets/${key}?v=${updatedAt.getTime().toString(36)}`
}

async function fetchRow(userId: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return row ?? null
}

async function deleteOldAssets(
  userId: string,
  role: "avatar" | "banner"
): Promise<void> {
  const exts = Object.values(EXT_FOR_CONTENT_TYPE)
  await Promise.all(
    exts.map((ext) => storage.delete(userAssetKey(userId, role, ext)))
  )
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
          { error: `Avatar too large. Max ${MAX_AVATAR_BYTES / 1024 / 1024} MB` },
          413
        )
      }

      const ext = EXT_FOR_CONTENT_TYPE[contentType] ?? ".bin"
      const key = userAssetKey(viewerId, "avatar", ext)

      await deleteOldAssets(viewerId, "avatar")
      await storage.put(key, buf, contentType)

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
          { error: `Banner too large. Max ${MAX_BANNER_BYTES / 1024 / 1024} MB` },
          413
        )
      }

      const ext = EXT_FOR_CONTENT_TYPE[contentType] ?? ".bin"
      const key = userAssetKey(viewerId, "banner", ext)

      await deleteOldAssets(viewerId, "banner")
      await storage.put(key, buf, contentType)

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

  c.header("Content-Type", resolved.contentType)
  c.header("Content-Length", String(resolved.size))
  c.header("Cache-Control", "public, max-age=86400, immutable")

  if (resolved.size <= 10 * 1024 * 1024) {
    const buf = await readAll(resolved.stream())
    return c.body(
      buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      ) as ArrayBuffer
    )
  }

  const node = resolved.stream()
  return stream(c, async (s) => {
    s.onAbort(() => {
      node.destroy()
    })
    await s.pipe(nodeToWeb(node))
  })
})
