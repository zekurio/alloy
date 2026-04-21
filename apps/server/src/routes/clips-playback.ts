import { zValidator } from "@hono/zod-validator"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { stream } from "hono/streaming"

import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { storage } from "../storage"
import {
  contentDisposition,
  DownloadQuery,
  downloadFilename,
  findEncodedVariant,
  IdParam,
  nodeToWeb,
  parseRange,
  peekViewer,
  readAll,
  StreamQuery,
} from "./clips-helpers"

export const clipsPlaybackRoutes = new Hono()
  .get(
    "/:id/stream",
    zValidator("param", IdParam),
    zValidator("query", StreamQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { variant: requestedVariant } = c.req.valid("query")
      const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)

      const viewer = await peekViewer(c.req.raw.headers)
      const isOwner = viewer?.id === row.authorId
      const isAdmin = viewer?.role === "admin"

      if (row.privacy === "private" && !isOwner && !isAdmin) {
        return viewer
          ? c.json({ error: "Forbidden" }, 403)
          : c.json({ error: "Unauthorized" }, 401)
      }
      if (row.status !== "ready" && requestedVariant !== "source") {
        return c.json({ error: "Clip not ready" }, 404)
      }

      const selected =
        requestedVariant === "source"
          ? { key: row.storageKey, contentType: row.contentType, id: "source" }
          : (() => {
              const variant = findEncodedVariant(row, requestedVariant)
              if (!variant) return null
              return {
                key: variant.storageKey,
                contentType: variant.contentType,
                id: variant.id,
              }
            })()

      if (!selected) {
        return c.json({ error: "Unknown quality" }, 404)
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
      const cacheControl =
        row.privacy === "public"
          ? "public, max-age=300"
          : "private, max-age=300"

      if (range) {
        const length = range.end - range.start + 1
        const node = resolved.stream({ start: range.start, end: range.end })
        c.header("Content-Type", contentType)
        c.header(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${resolved.size}`
        )
        c.header("Content-Length", String(length))
        c.header("Accept-Ranges", "bytes")
        c.header("Cache-Control", cacheControl)
        c.status(206)
        return stream(c, async (s) => {
          s.onAbort(() => {
            node.destroy()
          })
          await s.pipe(nodeToWeb(node))
        })
      }

      const node = resolved.stream()
      c.header("Content-Type", contentType)
      c.header("Content-Length", String(resolved.size))
      c.header("Accept-Ranges", "bytes")
      c.header("Cache-Control", cacheControl)
      return stream(c, async (s) => {
        s.onAbort(() => {
          node.destroy()
        })
        await s.pipe(nodeToWeb(node))
      })
    }
  )

  /**
   * GET /api/clips/:id/thumbnail — poster image for the player and
   * queue/grid cards. Returns 404 when the encoder couldn't produce
   * one (intentional — the UI falls back to a gradient placeholder,
   * which it does for unencoded clips too).
   */
  .get(
    "/:id/thumbnail",
    zValidator("param", IdParam),
    async (c) => {
      const { id } = c.req.valid("param")

      const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)

      const viewer = await peekViewer(c.req.raw.headers)
      const isOwner = viewer?.id === row.authorId
      const isAdmin = viewer?.role === "admin"
      if (row.privacy === "private" && !isOwner && !isAdmin) {
        return viewer
          ? c.json({ error: "Forbidden" }, 403)
          : c.json({ error: "Unauthorized" }, 401)
      }
      if (row.status !== "ready" && !isOwner && !isAdmin) {
        return c.json({ error: "Not found" }, 404)
      }

      const key = row.thumbKey
      if (!key) return c.json({ error: "No thumbnail" }, 404)

      const resolved = await storage.resolve(key)
      if (!resolved) return c.json({ error: "No thumbnail" }, 404)

      const buf = await readAll(resolved.stream())
      c.header("Content-Type", resolved.contentType)
      c.header("Content-Length", String(buf.byteLength))
      c.header(
        "Cache-Control",
        row.privacy === "public" && row.status === "ready"
          ? "public, max-age=86400"
          : "private, max-age=86400"
      )
      return c.body(
        buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength
        ) as ArrayBuffer
      )
    }
  )

  .get(
    "/:id/download",
    zValidator("param", IdParam),
    zValidator("query", DownloadQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { variant: requestedVariant } = c.req.valid("query")

      const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)

      const viewer = await peekViewer(c.req.raw.headers)
      const isOwner = viewer?.id === row.authorId
      const isAdmin = viewer?.role === "admin"

      if (row.privacy === "private" && !isOwner && !isAdmin) {
        return viewer
          ? c.json({ error: "Forbidden" }, 403)
          : c.json({ error: "Unauthorized" }, 401)
      }
      if (row.status !== "ready" && !isOwner && !isAdmin) {
        return c.json({ error: "Not found" }, 404)
      }

      const selected =
        requestedVariant === "source"
          ? {
              key: row.storageKey,
              contentType: row.contentType,
              filename: downloadFilename(row, "source"),
            }
          : (() => {
              if (row.status !== "ready") return null
              const encodedVariant = findEncodedVariant(row, requestedVariant)
              if (!encodedVariant) return null
              return {
                key: encodedVariant.storageKey,
                contentType: encodedVariant.contentType,
                filename: downloadFilename(row, encodedVariant),
              }
            })()

      if (!selected) {
        return c.json({ error: "Unknown download variant" }, 404)
      }

      const resolved = await storage.resolve(selected.key)
      if (!resolved) {
        return c.json({ error: "Download unavailable" }, 404)
      }

      c.header("Content-Type", selected.contentType || resolved.contentType)
      c.header("Content-Length", String(resolved.size))
      c.header("Content-Disposition", contentDisposition(selected.filename))
      c.header(
        "Cache-Control",
        row.privacy === "public"
          ? "public, max-age=300"
          : "private, max-age=300"
      )

      const node = resolved.stream()
      return stream(c, async (s) => {
        s.onAbort(() => {
          node.destroy()
        })
        await s.pipe(nodeToWeb(node))
      })
    }
  )
