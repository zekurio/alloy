import { Buffer } from "node:buffer"
import { Readable } from "node:stream"

import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, gte, inArray, lt, ne, type SQL } from "drizzle-orm"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { nanoid } from "nanoid"
import { z } from "zod"

import { getAuth } from "../auth"
import { CLIP_PRIVACY, clip, user } from "@workspace/db/schema"

import { db } from "../db"
import { configStore } from "../lib/config-store"
import { requireSession } from "../lib/require-session"
import { ENCODE_JOB, getBoss } from "../queue"
import { clipAssetKey, storage } from "../storage"

/**
 * Clip read + write surface. Reads are unauthenticated (and filtered to
 * `status='ready'` + `privacy != 'private'` so unfinished or private
 * clips don't leak into the home feed). Writes follow the two-phase
 * upload contract documented on the `clip` table: initiate reserves a
 * row and hands back an HMAC'd upload ticket; the browser uploads
 * directly to the storage driver; finalize flips the row to `uploaded`
 * and enqueues the encode job. The encoder takes it the rest of the
 * way (`uploaded → encoding → ready` or `failed`).
 *
 * The proxied stream + thumbnail endpoints serve playback. Privacy is
 * enforced here, not at storage-driver level — the driver doesn't know
 * which user is asking.
 */

// ─── Validation ────────────────────────────────────────────────────────

const IdParam = z.object({ id: z.uuid() })

// Feed query shape. Overloads `GET /api/clips` as the single read surface
// for both the home page's Top/Recent sections and the profile page:
//   - `window=today|week|month` narrows by recency (top-of-window reads)
//   - `sort=top` orders by likeCount desc; `sort=recent` (default) by createdAt
//   - `cursor` is an ISO timestamp; the server returns rows with
//     `createdAt < cursor` so the home feed can paginate through newest-first
//     pages without duplicating rows across batches
//   - `limit` defaults to 50, capped at 100 so a client can't ask for the
//     whole table in one trip
const ListQuery = z.object({
  window: z.enum(["today", "week", "month"]).optional(),
  sort: z.enum(["top", "recent"]).default("recent"),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.iso.datetime().optional(),
})

// Epoch offsets for the window filter. Kept in one place so both the feed
// read and any future analytics rollups agree on what "today" means.
const WINDOW_MS: Record<"today" | "week" | "month", number> = {
  today: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
}

// What the upload modal is allowed to feed us. Container/codec sanity
// is enforced again by ffprobe in the worker, but we pre-screen here so
// a weird body never even gets a storage key.
const ACCEPTED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
] as const

// `sizeBytes` is bounded by the admin-controlled `limits.maxUploadBytes`
// instead of a baked-in max — the schema reads the *current* value at
// validation time so a limit change applies to the next call without
// a server restart. Out-of-band hand-edited rows are protected at upload
// time too: the storage upload route enforces the same cap from the
// signed ticket payload.
// Hard cap on each client-produced thumbnail. JPEGs at 640/160 come in
// well under 128 KB in practice; the cap mostly exists so a tampered
// client can't smuggle a giant payload past the signed ticket budget.
const MAX_THUMB_BYTES = 2 * 1024 * 1024

const InitiateBody = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: z.enum(ACCEPTED_CONTENT_TYPES),
    sizeBytes: z.number().int().positive(),
    title: z.string().min(1).max(100),
    description: z.string().max(2000).optional(),
    game: z.string().max(120).optional(),
    privacy: z.enum(CLIP_PRIVACY).default("public"),
    // Optional trim window the modal picked, in milliseconds against
    // the source. Both must be set or both omitted — cross-field check
    // below. Bounds against the source's actual duration happen in the
    // encode worker (we don't know the duration server-side until the
    // ffprobe pass).
    trimStartMs: z.number().int().min(0).optional(),
    trimEndMs: z.number().int().positive().optional(),
    // Client-captured thumbnails. Both are required — the modal takes
    // the frame in-browser before hitting /initiate, so if we got this
    // far the blobs exist. Size bounds are baked into the matching
    // upload tickets below.
    thumbSizeBytes: z.number().int().positive().max(MAX_THUMB_BYTES),
    thumbSmallSizeBytes: z.number().int().positive().max(MAX_THUMB_BYTES),
  })
  .refine((b) => b.sizeBytes <= configStore.get("limits").maxUploadBytes, {
    message: "sizeBytes exceeds the configured maximum upload size",
    path: ["sizeBytes"],
  })
  .refine(
    (b) =>
      (b.trimStartMs == null && b.trimEndMs == null) ||
      (b.trimStartMs != null && b.trimEndMs != null && b.trimEndMs > b.trimStartMs),
    {
      message: "trimStartMs and trimEndMs must both be set with end > start",
      path: ["trimEndMs"],
    }
  )

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Extract the role of the logged-in viewer for ad-hoc privacy checks
 * on otherwise-unauthenticated routes (stream, thumbnail). Returns null
 * for signed-out requests so callers can branch cleanly.
 */
async function peekViewer(
  headers: Headers
): Promise<{ id: string; role: string | null } | null> {
  const session = await getAuth().api.getSession({ headers })
  if (!session) return null
  return {
    id: session.user.id,
    role: (session.user as { role?: string | null }).role ?? null,
  }
}

/** Parse an HTTP `Range: bytes=A-B` header into inclusive byte offsets. */
function parseRange(
  rangeHeader: string | undefined,
  size: number
): { start: number; end: number } | null {
  if (!rangeHeader) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const startStr = match[1] ?? ""
  const endStr = match[2] ?? ""
  let start: number
  let end: number
  if (startStr === "" && endStr !== "") {
    // Suffix range: last N bytes.
    const suffix = Number.parseInt(endStr, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else if (startStr !== "") {
    start = Number.parseInt(startStr, 10)
    end = endStr ? Number.parseInt(endStr, 10) : size - 1
  } else {
    return null
  }
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end >= size ||
    start > end
  ) {
    return null
  }
  return { start, end }
}

// ─── Routes ────────────────────────────────────────────────────────────

export const clips = new Hono()
  /**
   * GET /api/clips — ready public/unlisted clips with author info joined.
   * Single read surface for the home feed's Top and Recent sections.
   *
   * Query params (all optional):
   *   - `window=today|week|month` filters by createdAt (top-of-window)
   *   - `sort=top|recent` orders by likeCount desc / createdAt desc
   *   - `cursor=<iso>` returns rows with createdAt < cursor (recent paging)
   *   - `limit=<n>` defaults 50, capped at 100
   *
   * Privacy filter stays `['public','unlisted']` — private rows never
   * surface in the feed. Encoding-in-progress rows stay hidden until
   * `status='ready'`. Author handle + image are joined in from `user` so
   * clip cards don't need a follow-up N+1 round trip.
   */
  .get("/", zValidator("query", ListQuery), async (c) => {
    const { window, sort, cursor, limit } = c.req.valid("query")

    const conditions: SQL[] = [
      eq(clip.status, "ready"),
      inArray(clip.privacy, ["public", "unlisted"]),
    ]
    if (window) {
      conditions.push(gte(clip.createdAt, new Date(Date.now() - WINDOW_MS[window])))
    }
    if (cursor) {
      conditions.push(lt(clip.createdAt, new Date(cursor)))
    }

    // Top: likes desc with createdAt tiebreak so a flood of zero-like
    // clips doesn't wedge the ordering. Recent: straight newest-first.
    const orderBy =
      sort === "top"
        ? [desc(clip.likeCount), desc(clip.createdAt)]
        : [desc(clip.createdAt)]

    const rows = await db
      .select({
        id: clip.id,
        slug: clip.slug,
        authorId: clip.authorId,
        title: clip.title,
        description: clip.description,
        game: clip.game,
        privacy: clip.privacy,
        storageKey: clip.storageKey,
        contentType: clip.contentType,
        sizeBytes: clip.sizeBytes,
        durationMs: clip.durationMs,
        width: clip.width,
        height: clip.height,
        trimStartMs: clip.trimStartMs,
        trimEndMs: clip.trimEndMs,
        thumbKey: clip.thumbKey,
        thumbSmallKey: clip.thumbSmallKey,
        viewCount: clip.viewCount,
        likeCount: clip.likeCount,
        commentCount: clip.commentCount,
        status: clip.status,
        encodeProgress: clip.encodeProgress,
        failureReason: clip.failureReason,
        createdAt: clip.createdAt,
        updatedAt: clip.updatedAt,
        authorUsername: user.username,
        authorImage: user.image,
      })
      .from(clip)
      .innerJoin(user, eq(clip.authorId, user.id))
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(limit)
    return c.json(rows)
  })

  /**
   * GET /api/clips/queue — viewer's own in-flight clips for the upload
   * queue modal. Returns the rows the modal needs to render
   * `pending|uploaded|encoding|failed` rows; `ready` rows are excluded
   * because they belong on the home feed instead. Capped at 50 so a
   * runaway queue can't blow up the response.
   */
  .get("/queue", requireSession, async (c) => {
    const viewerId = c.var.viewerId
    const rows = await db
      .select({
        id: clip.id,
        slug: clip.slug,
        title: clip.title,
        status: clip.status,
        encodeProgress: clip.encodeProgress,
        failureReason: clip.failureReason,
        createdAt: clip.createdAt,
      })
      .from(clip)
      .where(and(eq(clip.authorId, viewerId), ne(clip.status, "ready")))
      .orderBy(desc(clip.createdAt))
      .limit(50)
    return c.json(rows)
  })

  /**
   * GET /api/clips/:id — single clip lookup. Same privacy filter as the
   * list endpoint — private/non-ready rows return 404 to
   * unauthenticated callers so we don't even acknowledge their
   * existence. Owners and admins see their own clips regardless of
   * status (so the upload modal can navigate to a freshly-published
   * clip immediately).
   */
  .get("/:id", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
    if (!row) return c.json({ error: "Not found" }, 404)

    const viewer = await peekViewer(c.req.raw.headers)
    const isOwner = viewer?.id === row.authorId
    const isAdmin = viewer?.role === "admin"

    if (row.privacy === "private" && !isOwner && !isAdmin) {
      return c.json({ error: "Not found" }, 404)
    }
    if (row.status !== "ready" && !isOwner && !isAdmin) {
      return c.json({ error: "Not found" }, 404)
    }
    return c.json(row)
  })

  /**
   * POST /api/clips/initiate — reserve a row in `pending` and return
   * the upload ticket the browser will POST bytes to. The ticket is
   * scoped to the viewer + the new clip id, so a stolen ticket can't
   * be replayed against a different user's clip. The body's metadata
   * (title/description/game/privacy) lands on the row immediately —
   * `finalize` doesn't re-accept it.
   */
  .post(
    "/initiate",
    requireSession,
    zValidator("json", InitiateBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const body = c.req.valid("json")

      const clipId = crypto.randomUUID()
      const slug = nanoid(10)
      const storageKey = clipAssetKey(clipId, "source")
      const thumbKey = clipAssetKey(clipId, "thumb")
      const thumbSmallKey = clipAssetKey(clipId, "thumb-small")

      // The "friends" privacy option exists in the modal but the DB
      // schema only knows public/unlisted/private. Until the follow
      // graph is wired into the read side we coerce friends → private,
      // matching the cut line documented in the plan.
      const privacy = body.privacy === "private" ? "private" : body.privacy

      // Pre-fill the thumb keys up front so the row points at the right
      // storage locations before the bytes have landed — finalize verifies
      // the bytes are actually there, and the encode worker will re-use
      // the keys rather than re-generating from ffmpeg.
      await db.insert(clip).values({
        id: clipId,
        slug,
        authorId: viewerId,
        title: body.title,
        description: body.description ?? null,
        game: body.game ?? null,
        privacy,
        storageKey,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        thumbKey,
        thumbSmallKey,
        // Trim columns are nullable on the row; either both are set
        // (the modal picked a range) or both stay null (use full source).
        // The refine() above guarantees we never get one without the other.
        trimStartMs: body.trimStartMs ?? null,
        trimEndMs: body.trimEndMs ?? null,
        status: "pending",
      })

      const expiresInSec = configStore.get("limits").uploadTtlSec
      const [ticket, thumbTicket, thumbSmallTicket] = await Promise.all([
        storage.mintUploadUrl({
          key: storageKey,
          contentType: body.contentType,
          maxBytes: body.sizeBytes,
          expiresInSec,
          userId: viewerId,
          clipId,
        }),
        storage.mintUploadUrl({
          key: thumbKey,
          contentType: "image/jpeg",
          maxBytes: body.thumbSizeBytes,
          expiresInSec,
          userId: viewerId,
          clipId,
        }),
        storage.mintUploadUrl({
          key: thumbSmallKey,
          contentType: "image/jpeg",
          maxBytes: body.thumbSmallSizeBytes,
          expiresInSec,
          userId: viewerId,
          clipId,
        }),
      ])

      return c.json({ clipId, slug, ticket, thumbTicket, thumbSmallTicket })
    }
  )

  /**
   * POST /api/clips/:id/finalize — bytes have landed; verify, stat,
   * flip status to `uploaded`, and enqueue the encode job. The encoder
   * takes it from there.
   *
   * Owner-only and `pending`-only — re-finalize on an already-encoded
   * clip would either duplicate work (best case) or stomp the encoded
   * output (worst case).
   */
  .post(
    "/:id/finalize",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)
      if (row.authorId !== viewerId) {
        return c.json({ error: "Forbidden" }, 403)
      }
      if (row.status !== "pending") {
        return c.json({ error: `Clip is already ${row.status}` }, 409)
      }

      const resolved = await storage.resolve(row.storageKey)
      if (!resolved) {
        return c.json({ error: "Upload bytes are missing" }, 400)
      }

      // Client-captured thumbnails are required — if either is missing,
      // we refuse to advance. The encode worker will reuse the existing
      // keys (set at /initiate) instead of shelling out to ffmpeg for a
      // poster.
      if (row.thumbKey) {
        const thumbResolved = await storage.resolve(row.thumbKey)
        if (!thumbResolved) {
          return c.json({ error: "Thumbnail bytes are missing" }, 400)
        }
      }
      if (row.thumbSmallKey) {
        const thumbSmallResolved = await storage.resolve(row.thumbSmallKey)
        if (!thumbSmallResolved) {
          return c.json({ error: "Small thumbnail bytes are missing" }, 400)
        }
      }

      await db
        .update(clip)
        .set({
          status: "uploaded",
          sizeBytes: resolved.size,
          updatedAt: new Date(),
        })
        .where(eq(clip.id, id))

      await getBoss().send(ENCODE_JOB, { clipId: id })

      const [updated] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      return c.json(updated)
    }
  )

  /**
   * DELETE /api/clips/:id — owner or admin can drop a clip and its
   * associated bytes. The DB's cascade FKs handle likes/comments/views/
   * mentions; we best-effort the storage objects (logging failures
   * rather than blocking the row delete — orphan bytes are recoverable,
   * orphan rows that point at deleted bytes look broken in the UI).
   */
  .delete(
    "/:id",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const session = await getAuth().api.getSession({
        headers: c.req.raw.headers,
      })
      const isAdmin =
        (session?.user as { role?: string | null } | undefined)?.role === "admin"

      const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)
      if (row.authorId !== viewerId && !isAdmin) {
        return c.json({ error: "Forbidden" }, 403)
      }

      // Wipe every key we could have produced for this clip — source,
      // encoded video, both thumbnails. delete() is no-op on missing.
      const keys = [
        row.storageKey,
        clipAssetKey(id, "video"),
        row.thumbKey ?? clipAssetKey(id, "thumb"),
        row.thumbSmallKey ?? clipAssetKey(id, "thumb-small"),
      ]
      for (const key of keys) {
        try {
          await storage.delete(key)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[clips] failed to delete ${key}:`, err)
        }
      }

      await db.delete(clip).where(eq(clip.id, id))
      return c.json({ deleted: true })
    }
  )

  /**
   * GET /api/clips/:id/stream — Range-capable video stream. Public and
   * unlisted clips are open; private clips require an owner/admin
   * session. Only `ready` clips stream — earlier states return 404 to
   * outside callers (the encoder hasn't produced the playable bytes
   * yet) and the encoded `video` key is what we serve, never the
   * source.
   *
   * Range support is what makes seeking work in the <video> element —
   * without it the browser can only play from byte 0.
   */
  .get("/:id/stream", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
    if (!row) return c.json({ error: "Not found" }, 404)

    const viewer = await peekViewer(c.req.raw.headers)
    const isOwner = viewer?.id === row.authorId
    const isAdmin = viewer?.role === "admin"

    if (row.privacy === "private" && !isOwner && !isAdmin) {
      // 401 not 404 — the row exists, the viewer just isn't allowed to
      // see it. Helps the browser distinguish "wrong cookie" from "bad
      // url" without leaking which one it is.
      return viewer
        ? c.json({ error: "Forbidden" }, 403)
        : c.json({ error: "Unauthorized" }, 401)
    }
    if (row.status !== "ready") {
      return c.json({ error: "Clip not ready" }, 404)
    }

    const videoKey = clipAssetKey(id, "video")
    const resolved = await storage.resolve(videoKey)
    if (!resolved) {
      // Status says ready but the bytes are missing — encoder lost
      // them, or the row was hand-edited. 404 plus a log; the reaper
      // is the right place to clean this up if it persists.
      // eslint-disable-next-line no-console
      console.error(`[clips] encoded bytes missing for ready clip ${id}`)
      return c.json({ error: "Stream unavailable" }, 404)
    }

    const range = parseRange(c.req.header("range"), resolved.size)
    const contentType = row.contentType.startsWith("video/")
      ? "video/mp4"
      : resolved.contentType
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control":
        row.privacy === "public"
          ? "public, max-age=300"
          : "private, max-age=300",
    }

    if (range) {
      const length = range.end - range.start + 1
      headers["Content-Length"] = String(length)
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${resolved.size}`
      const node = resolved.stream({ start: range.start, end: range.end })
      c.header("Content-Type", contentType)
      c.header("Content-Range", headers["Content-Range"])
      c.header("Content-Length", headers["Content-Length"])
      c.header("Accept-Ranges", "bytes")
      c.header("Cache-Control", headers["Cache-Control"])
      c.status(206)
      return stream(c, async (s) => {
        s.onAbort(() => {
          node.destroy()
        })
        await s.pipe(nodeToWeb(node))
      })
    }

    headers["Content-Length"] = String(resolved.size)
    const node = resolved.stream()
    c.header("Content-Type", contentType)
    c.header("Content-Length", headers["Content-Length"])
    c.header("Accept-Ranges", "bytes")
    c.header("Cache-Control", headers["Cache-Control"])
    return stream(c, async (s) => {
      s.onAbort(() => {
        node.destroy()
      })
      await s.pipe(nodeToWeb(node))
    })
  })

  /**
   * GET /api/clips/:id/thumbnail?size=small — poster image for the
   * player and the queue/grid cards. Returns 404 when the encoder
   * couldn't produce one (intentional — the UI falls back to a
   * gradient placeholder, which it does for unencoded clips too).
   */
  .get(
    "/:id/thumbnail",
    zValidator("param", IdParam),
    zValidator(
      "query",
      z.object({ size: z.enum(["small", "full"]).default("full") })
    ),
    async (c) => {
      const { id } = c.req.valid("param")
      const { size } = c.req.valid("query")

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

      const key = size === "small" ? row.thumbSmallKey : row.thumbKey
      if (!key) return c.json({ error: "No thumbnail" }, 404)

      const resolved = await storage.resolve(key)
      if (!resolved) return c.json({ error: "No thumbnail" }, 404)

      const buf = await readAll(resolved.stream())
      c.header("Content-Type", resolved.contentType)
      c.header("Content-Length", String(buf.byteLength))
      c.header("Cache-Control", "public, max-age=86400")
      // c.body() wants ArrayBuffer, not Uint8Array — slice into a fresh
      // ArrayBuffer so any underlying SharedArrayBuffer / sub-view
      // doesn't leak into the response.
      return c.body(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    }
  )

// ─── Stream helpers ────────────────────────────────────────────────────

/**
 * Adapt a node Readable into a web ReadableStream so Hono's `stream()`
 * helper can pipe it. `Readable.toWeb` is the standard adapter; the cast
 * smooths over the @types/node generic mismatch (it returns
 * `ReadableStream<unknown>` in some versions).
 */
function nodeToWeb(node: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(node) as ReadableStream<Uint8Array>
}

/**
 * Buffer a small node stream into memory. Used for the thumbnail route
 * where the payload is bounded (tens of KB) and `c.body()` wants a
 * single buffer. Never call this on the video stream.
 */
async function readAll(node: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of node) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}
