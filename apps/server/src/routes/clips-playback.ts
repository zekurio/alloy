import { zValidator } from "@hono/zod-validator"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { stream } from "hono/streaming"

import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { storage } from "../storage"
import {
  contentDisposition,
  DownloadQuery,
  downloadFilename,
  findEncodedVariant,
  IdParam,
  parseRange,
  peekViewer,
  readAll,
  StreamQuery,
} from "./clips-helpers"

async function selectPlaybackClip(id: string) {
  const [row] = await db
    .select({
      clip,
      authorDisabledAt: user.disabledAt,
    })
    .from(clip)
    .innerJoin(user, eq(clip.authorId, user.id))
    .where(eq(clip.id, id))
    .limit(1)
  return row ?? null
}

export const clipsPlaybackRoutes = new Hono()
  .get(
    "/:id/stream",
    zValidator("param", IdParam),
    zValidator("query", StreamQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { variant: requestedVariant } = c.req.valid("query")
      const selectedRow = await selectPlaybackClip(id)
      const row = selectedRow?.clip
      if (!row) return c.json({ error: "Not found" }, 404)

      const viewer = await peekViewer(c.req.raw.headers)
      const isOwner = viewer?.id === row.authorId
      const isAdmin = viewer?.role === "admin"
      const isPrivate = row.privacy === "private"

      if (isPrivate) {
        c.header("Cache-Control", "no-store")
      }

      if (selectedRow.authorDisabledAt && !isOwner && !isAdmin) {
        return c.json({ error: "Not found" }, 404)
      }
      if (isPrivate && !isOwner && !isAdmin) {
        return viewer
          ? c.json({ error: "Forbidden" }, 403)
          : c.json({ error: "Unauthorized" }, 401)
      }
      if (row.status !== "ready") {
        return c.json({ error: "Clip not ready" }, 404)
      }

      const variant =
        requestedVariant === "source"
          ? null
          : findEncodedVariant(row, requestedVariant)
      const selected =
        requestedVariant === "source"
          ? row.sourceKey && row.sourceContentType
            ? {
                key: row.sourceKey,
                contentType: row.sourceContentType,
                id: "source",
              }
            : null
          : variant
            ? {
                key: variant.storageKey,
                contentType: variant.contentType,
                id: variant.id,
              }
            : null

      if (!selected) {
        return c.json({ error: "Unknown quality" }, 404)
      }

      const cacheControl =
        row.privacy === "public"
          ? "public, max-age=300"
          : row.privacy === "private"
            ? "no-store"
            : "private, max-age=300"

      if (!isPrivate && c.req.method !== "HEAD") {
        const direct = await storage.mintDownloadUrl(selected.key, {
          expiresInSec: 900,
          responseContentType: selected.contentType || undefined,
          responseCacheControl: cacheControl,
        })
        if (direct) {
          c.header("Cache-Control", "private, max-age=60")
          return c.redirect(direct.url, 302)
        }
      }

      const resolved = await storage.resolve(selected.key)
      if (!resolved) {
        // eslint-disable-next-line no-console
        console.error(
          `[clips] bytes missing for ready clip ${id} (${selected.id})`
        )
        return c.json({ error: "Stream unavailable" }, 404)
      }

      const range = parseRange(c.req.header("range"), resolved.size)
      const contentType = selected.contentType || resolved.contentType

      if (range) {
        const length = range.end - range.start + 1
        const body = resolved.stream({ start: range.start, end: range.end })
        c.header("Content-Type", contentType)
        c.header(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${resolved.size}`
        )
        c.header("Content-Length", String(length))
        c.header("Accept-Ranges", "bytes")
        c.header("Cache-Control", cacheControl)
        c.status(206)
        if (c.req.method === "HEAD") return c.body(null)
        return stream(c, async (s) => {
          s.onAbort(() => body.cancel().catch(() => undefined))
          await s.pipe(body)
        })
      }

      const body = resolved.stream()
      c.header("Content-Type", contentType)
      c.header("Content-Length", String(resolved.size))
      c.header("Accept-Ranges", "bytes")
      c.header("Cache-Control", cacheControl)
      if (c.req.method === "HEAD") return c.body(null)
      return stream(c, async (s) => {
        s.onAbort(() => body.cancel().catch(() => undefined))
        await s.pipe(body)
      })
    }
  )

  /**
   * GET /api/clips/:id/thumbnail — poster image for the player and
   * queue/grid cards. Returns 404 when the encoder couldn't produce
   * one (intentional — the UI falls back to a gradient placeholder,
   * which it does for unencoded clips too).
   */
  .get("/:id/thumbnail", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")

    const selectedRow = await selectPlaybackClip(id)
    const row = selectedRow?.clip
    if (!row) return c.json({ error: "Not found" }, 404)

    const viewer = await peekViewer(c.req.raw.headers)
    const isOwner = viewer?.id === row.authorId
    const isAdmin = viewer?.role === "admin"
    const isPrivate = row.privacy === "private"

    if (isPrivate) {
      c.header("Cache-Control", "no-store")
    }

    if (selectedRow.authorDisabledAt && !isOwner && !isAdmin) {
      return c.json({ error: "Not found" }, 404)
    }
    if (isPrivate && !isOwner && !isAdmin) {
      return viewer
        ? c.json({ error: "Forbidden" }, 403)
        : c.json({ error: "Unauthorized" }, 401)
    }
    if (row.status !== "ready" && !isOwner && !isAdmin) {
      return c.json({ error: "Not found" }, 404)
    }

    const key = row.thumbKey
    if (!key) return c.json({ error: "No thumbnail" }, 404)

    const thumbCacheControl =
      row.privacy === "public" && row.status === "ready"
        ? "public, max-age=86400"
        : row.privacy === "private"
          ? "no-store"
          : "private, max-age=86400"

    if (!isPrivate && c.req.method !== "HEAD") {
      const direct = await storage.mintDownloadUrl(key, {
        expiresInSec: 900,
        responseCacheControl: thumbCacheControl,
      })
      if (direct) {
        c.header("Cache-Control", "private, max-age=60")
        return c.redirect(direct.url, 302)
      }
    }

    const resolved = await storage.resolve(key)
    if (!resolved) return c.json({ error: "No thumbnail" }, 404)

    c.header("Content-Type", resolved.contentType)
    c.header("Content-Length", String(resolved.size))
    c.header("Cache-Control", thumbCacheControl)
    if (c.req.method === "HEAD") return c.body(null)

    const buf = await readAll(resolved.stream())
    return c.body(
      buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      ) as ArrayBuffer
    )
  })

  .get("/:id/opengraph", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const selectedRow = await selectPlaybackClip(id)
    const row = selectedRow?.clip
    if (!row) return c.json({ error: "Not found" }, 404)

    if (row.status !== "ready" || !row.openGraphKey) {
      return c.json({ error: "Not found" }, 404)
    }
    if (row.privacy === "private") {
      return c.json({ error: "Not found" }, 404)
    }
    if (selectedRow.authorDisabledAt) {
      return c.json({ error: "Not found" }, 404)
    }

    const direct = await storage.mintDownloadUrl(row.openGraphKey, {
      expiresInSec: 900,
      responseContentType: row.openGraphContentType ?? "video/mp4",
      responseCacheControl: "public, max-age=300",
    })
    if (direct && c.req.method !== "HEAD") {
      c.header("Cache-Control", "private, max-age=60")
      return c.redirect(direct.url, 302)
    }

    const resolved = await storage.resolve(row.openGraphKey)
    if (!resolved) return c.json({ error: "OpenGraph unavailable" }, 404)
    c.header("Content-Type", row.openGraphContentType ?? resolved.contentType)
    c.header("Content-Length", String(resolved.size))
    c.header("Accept-Ranges", "bytes")
    c.header("Cache-Control", "public, max-age=300")
    if (c.req.method === "HEAD") return c.body(null)
    const body = resolved.stream()
    return stream(c, async (s) => {
      s.onAbort(() => body.cancel().catch(() => undefined))
      await s.pipe(body)
    })
  })

  .get(
    "/:id/download",
    zValidator("param", IdParam),
    zValidator("query", DownloadQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { variant: requestedVariant } = c.req.valid("query")

      const selectedRow = await selectPlaybackClip(id)
      const row = selectedRow?.clip
      if (!row) return c.json({ error: "Not found" }, 404)

      const viewer = await peekViewer(c.req.raw.headers)
      const isOwner = viewer?.id === row.authorId
      const isAdmin = viewer?.role === "admin"
      const isPrivate = row.privacy === "private"

      if (isPrivate) {
        c.header("Cache-Control", "no-store")
      }

      if (selectedRow.authorDisabledAt && !isOwner && !isAdmin) {
        return c.json({ error: "Not found" }, 404)
      }
      if (isPrivate && !isOwner && !isAdmin) {
        return viewer
          ? c.json({ error: "Forbidden" }, 403)
          : c.json({ error: "Unauthorized" }, 401)
      }
      if (row.status !== "ready" && !isOwner && !isAdmin) {
        return c.json({ error: "Not found" }, 404)
      }

      const encodedVariant =
        row.status === "ready" && requestedVariant !== "source"
          ? findEncodedVariant(row, requestedVariant)
          : null
      const selected =
        requestedVariant === "source"
          ? row.sourceKey && row.sourceContentType
            ? {
                key: row.sourceKey,
                contentType: row.sourceContentType,
                filename: downloadFilename(row, "source"),
              }
            : null
          : encodedVariant
            ? {
                key: encodedVariant.storageKey,
                contentType: encodedVariant.contentType,
                filename: downloadFilename(row, encodedVariant),
              }
            : null

      if (!selected) {
        return c.json({ error: "Unknown download variant" }, 404)
      }

      const dlCacheControl =
        row.privacy === "public"
          ? "public, max-age=300"
          : row.privacy === "private"
            ? "no-store"
            : "private, max-age=300"

      if (!isPrivate && c.req.method !== "HEAD") {
        const direct = await storage.mintDownloadUrl(selected.key, {
          expiresInSec: 900,
          responseContentType: selected.contentType || undefined,
          responseContentDisposition: contentDisposition(selected.filename),
          responseCacheControl: dlCacheControl,
        })
        if (direct) {
          c.header("Cache-Control", "private, max-age=60")
          return c.redirect(direct.url, 302)
        }
      }

      const resolved = await storage.resolve(selected.key)
      if (!resolved) {
        return c.json({ error: "Download unavailable" }, 404)
      }

      c.header("Content-Type", selected.contentType || resolved.contentType)
      c.header("Content-Length", String(resolved.size))
      c.header("Content-Disposition", contentDisposition(selected.filename))
      c.header("Cache-Control", dlCacheControl)
      if (c.req.method === "HEAD") return c.body(null)

      const body = resolved.stream()
      return stream(c, async (s) => {
        s.onAbort(() => body.cancel().catch(() => undefined))
        await s.pipe(body)
      })
    }
  )
