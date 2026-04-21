import { eq } from "drizzle-orm"
import type { Context } from "hono"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"

import { user } from "@workspace/db/auth-schema"

import { getAuth } from "../auth"
import { db } from "../db"
import {
  AVATAR_SPEC,
  BANNER_SPEC,
  ImageValidationError,
  resizeToJpeg,
  userAssetKey,
} from "../lib/image-resize"
import { syncOAuthImage, type SyncStatus } from "../lib/oauth-sync"
import { storage } from "../storage"

type Env = { Variables: { userId: string } }
type Role = "avatar" | "banner"

const requireSession = createMiddleware<Env>(async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  c.set("userId", session.user.id)
  await next()
})

const SYNC_MESSAGES: Record<SyncStatus, string> = {
  ok: "Profile image synced from the identity provider.",
  "no-oauth-provider": "No OAuth provider is configured for this server.",
  "no-linked-account":
    "Your account isn't linked to the OAuth provider yet. Sign in with it once to link.",
  "no-access-token":
    "No stored access token for your linked account — sign in with the OAuth provider again to refresh it.",
  "no-userinfo-url":
    "OAuth provider is misconfigured (missing userinfo endpoint).",
  "no-image-in-response":
    "The OAuth provider didn't return a profile picture for you.",
  "fetch-failed": "Couldn't reach the OAuth provider.",
}

const AVATAR_MAX_BYTES = 4 * 1024 * 1024
const BANNER_MAX_BYTES = 8 * 1024 * 1024
const ACCEPTED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
])

async function readBodyAsBuffer(
  request: Request,
  maxBytes: number
): Promise<Buffer | "too-large"> {
  const reader = request.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  let total = 0
  const chunks: Buffer[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return "too-large"
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

async function handleImageUpload(c: Context<Env>, role: Role) {
  const userId = c.var.userId
  const spec = role === "avatar" ? AVATAR_SPEC : BANNER_SPEC
  const maxBytes = role === "avatar" ? AVATAR_MAX_BYTES : BANNER_MAX_BYTES

  const contentType = c.req.header("content-type") ?? ""
  if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
    return c.json(
      { error: "Unsupported image type. Use JPEG, PNG, or WebP." },
      415
    )
  }

  const body = await readBodyAsBuffer(c.req.raw, maxBytes)
  if (body === "too-large") {
    return c.json(
      {
        error: `Image is too large — max ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      },
      413
    )
  }
  if (body.byteLength === 0) {
    return c.json({ error: "Empty upload." }, 400)
  }

  let jpeg: Buffer
  try {
    jpeg = await resizeToJpeg(body, spec)
  } catch (err) {
    if (err instanceof ImageValidationError) {
      return c.json({ error: err.message }, 422)
    }
    // eslint-disable-next-line no-console
    console.error(`[profile] ${role} resize failed:`, err)
    return c.json({ error: "Couldn't process image." }, 500)
  }

  const key = userAssetKey(userId, role)
  await storage.put(key, jpeg, "image/jpeg")

  const patch =
    role === "avatar"
      ? { imageKey: key, updatedAt: new Date() }
      : { bannerKey: key, updatedAt: new Date() }
  await db.update(user).set(patch).where(eq(user.id, userId))

  return c.json({ ok: true, key })
}

async function handleImageDelete(c: Context<Env>, role: Role) {
  const userId = c.var.userId
  const [row] = await db
    .select({ imageKey: user.imageKey, bannerKey: user.bannerKey })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!row) return c.json({ error: "Not found" }, 404)

  const existing = role === "avatar" ? row.imageKey : row.bannerKey
  if (existing) {
    await storage.delete(existing).catch(() => undefined)
  }

  const patch =
    role === "avatar"
      ? { imageKey: null, image: null, updatedAt: new Date() }
      : { bannerKey: null, updatedAt: new Date() }
  await db.update(user).set(patch).where(eq(user.id, userId))

  return c.json({ ok: true })
}

export const profileRoute = new Hono<Env>()
  .use("*", requireSession)
  .post("/sync-oauth-image", async (c) => {
    const userId = c.var.userId
    const result = await syncOAuthImage(userId, { overwrite: true })
    const body = {
      status: result.status,
      image: result.image,
      message:
        result.status === "fetch-failed" && result.message
          ? `${SYNC_MESSAGES[result.status]} (${result.message})`
          : SYNC_MESSAGES[result.status],
    }
    if (result.status === "ok") return c.json(body)
    return c.json(body, 400)
  })
  .post("/image", (c) => handleImageUpload(c, "avatar"))
  .delete("/image", (c) => handleImageDelete(c, "avatar"))
  .post("/banner", (c) => handleImageUpload(c, "banner"))
  .delete("/banner", (c) => handleImageDelete(c, "banner"))
