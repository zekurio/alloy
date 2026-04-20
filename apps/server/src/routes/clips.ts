import { Buffer } from "node:buffer"
import { Readable } from "node:stream"

import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { nanoid } from "nanoid"
import { z } from "zod"

import { getAuth } from "../auth"
import {
  CLIP_PRIVACY,
  clip,
  clipLike,
  game,
  type ClipEncodedVariant,
  user,
} from "@workspace/db/schema"

import { cache } from "../cache"
import { db } from "../db"
import { clipSelectShape, selectClipById } from "../lib/clip-select"
import { configStore } from "../lib/config-store"
import { requireSession } from "../lib/require-session"
import { applyViewerCookie, resolveViewer } from "../lib/viewer-key"
import { ENCODE_JOB, getBoss } from "../queue"
import { cancelEncode } from "../queue/encode-worker"
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
const StreamQuery = z.object({ variant: z.string().min(1).optional() })
const DownloadQuery = z.object({
  variant: z.string().min(1).default("source"),
})

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

// View dedup window. A qualifying `POST /view` from the same viewer on
// the same clip inside this window is a no-op; the next one past it
// counts again. 24h matches "once per day per viewer" which is roughly
// what users expect a "views" counter to mean. The cache driver enforces
// it; pg never sees duplicates inside the window.
const VIEW_DEDUP_TTL_SEC = 24 * 60 * 60

const InitiateBody = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: z.enum(ACCEPTED_CONTENT_TYPES),
    sizeBytes: z.number().int().positive(),
    title: z.string().min(1).max(100),
    description: z.string().max(2000).optional(),
    // SteamGridDB-mapped game. The upload modal resolves the
    // user's autocomplete pick to a `game.id` via `/api/games/resolve`
    // before hitting `/initiate`, so we only ever accept the FK here
    // — never free-form strings. The legacy `clip.game` text column
    // stays in the schema for old rows but is always null on new
    // uploads.
    gameId: z.uuid().optional(),
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
      (b.trimStartMs != null &&
        b.trimEndMs != null &&
        b.trimEndMs > b.trimStartMs),
    {
      message: "trimStartMs and trimEndMs must both be set with end > start",
      path: ["trimEndMs"],
    }
  )

// Post-publish edit surface. Every field is optional — the PATCH treats
// an absent key as "leave it alone", while an empty string on the free-
// text fields is a deliberate clear (lands as null in the DB). Trim,
// file, and thumbnails stay frozen because touching them would require
// re-encoding the already-encoded output.
const UpdateBody = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  // New uploads carry a `gameId`; the editor modal posts the same
  // shape on rename. An explicit `null` clears the mapping (the
  // clip is still listed on the feed but drops off /g/:slug).
  gameId: z.uuid().nullable().optional(),
  privacy: z.enum(CLIP_PRIVACY).optional(),
})

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

type PlaybackClipRow = typeof clip.$inferSelect

function encodedVariantsForRow(row: PlaybackClipRow): ClipEncodedVariant[] {
  if (row.variants.length > 0) {
    return row.variants
  }
  return [
    {
      id: "encoded",
      label: "Playback MP4",
      storageKey: clipAssetKey(row.id, "video"),
      contentType: "video/mp4",
      width: row.width ?? 0,
      height: row.height ?? 0,
      sizeBytes: row.sizeBytes ?? 0,
      isDefault: true,
    },
  ]
}

function findEncodedVariant(
  row: PlaybackClipRow,
  variantId: string | undefined
): ClipEncodedVariant | null {
  const variants = encodedVariantsForRow(row)
  if (!variantId) {
    return variants.find((variant) => variant.isDefault) ?? variants[0] ?? null
  }
  return variants.find((variant) => variant.id === variantId) ?? null
}

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case "video/mp4":
      return "mp4"
    case "video/quicktime":
      return "mov"
    case "video/x-matroska":
      return "mkv"
    case "video/webm":
      return "webm"
    default:
      return "bin"
  }
}

function contentDisposition(filename: string): string {
  const safeAscii = filename.replace(/[^A-Za-z0-9._-]+/g, "_")
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function downloadFilename(
  row: PlaybackClipRow,
  variant: "source" | ClipEncodedVariant
): string {
  const base = row.title.trim().replace(/[/\\?%*:|"<>]/g, "-") || row.id
  if (variant === "source") {
    return `${base}-source.${extensionForContentType(row.contentType)}`
  }
  return `${base}-${variant.id}.${extensionForContentType(variant.contentType)}`
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
      conditions.push(
        gte(clip.createdAt, new Date(Date.now() - WINDOW_MS[window]))
      )
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
      .select(clipSelectShape)
      .from(clip)
      .innerJoin(user, eq(clip.authorId, user.id))
      .leftJoin(game, eq(clip.gameId, game.id))
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
    const row = await selectClipById(id)
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
      // If the caller supplied a `gameId`, prove it exists before we
      // commit — the FK would catch a bogus id too, but that would
      // surface as an opaque 500 and we'd rather 400 on bad input.
      if (body.gameId) {
        const [gameRow] = await db
          .select({ id: game.id })
          .from(game)
          .where(eq(game.id, body.gameId))
          .limit(1)
        if (!gameRow) {
          return c.json({ error: "Unknown game" }, 400)
        }
      }

      await db.insert(clip).values({
        id: clipId,
        slug,
        authorId: viewerId,
        title: body.title,
        description: body.description ?? null,
        // Legacy `game` text column stays null on new uploads — the
        // mapped gameId below is the canonical reference.
        game: null,
        gameId: body.gameId ?? null,
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

      const boss = await getBoss()
      await boss.send(ENCODE_JOB, { clipId: id })

      const updated = await selectClipById(id)
      return c.json(updated)
    }
  )

  /**
   * PATCH /api/clips/:id — owner or admin edits post-publish metadata.
   * Only the fields safe to change without re-encoding the source are
   * accepted (title, description, game, privacy) — trimming, file
   * replacement, and thumbnails are upload-time-only. All fields are
   * optional; an empty body is a no-op. Returns the updated row so the
   * caller can swap it into the feed without a re-fetch.
   */
  .patch(
    "/:id",
    requireSession,
    zValidator("param", IdParam),
    zValidator("json", UpdateBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const session = await getAuth().api.getSession({
        headers: c.req.raw.headers,
      })
      const isAdmin =
        (session?.user as { role?: string | null } | undefined)?.role ===
        "admin"

      const [row] = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
      if (!row) return c.json({ error: "Not found" }, 404)
      if (row.authorId !== viewerId && !isAdmin) {
        return c.json({ error: "Forbidden" }, 403)
      }

      // Build the patch object explicitly so we never overwrite a column
      // the client didn't send. `description` accepts empty-string
      // clears from the form → null in the DB. `gameId` is a nullable
      // FK on the editor modal — `null` clears the mapping, a UUID
      // resolves to a new mapping (post-`/api/games/resolve`).
      const patch: Partial<typeof clip.$inferInsert> = {
        updatedAt: new Date(),
      }
      if (body.title !== undefined) patch.title = body.title
      if (body.description !== undefined) {
        patch.description = body.description === "" ? null : body.description
      }
      if (body.gameId !== undefined) {
        if (body.gameId === null) {
          patch.gameId = null
        } else {
          const [gameRow] = await db
            .select({ id: game.id })
            .from(game)
            .where(eq(game.id, body.gameId))
            .limit(1)
          if (!gameRow) {
            return c.json({ error: "Unknown game" }, 400)
          }
          patch.gameId = body.gameId
          // Clear the legacy text column on any mapped change — the
          // new `gameId` is now the authoritative reference. Leaving
          // both populated would confuse the UI's fallback-render logic.
          patch.game = null
        }
      }
      if (body.privacy !== undefined) patch.privacy = body.privacy

      await db.update(clip).set(patch).where(eq(clip.id, id))

      const updated = await selectClipById(id)
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
  .delete("/:id", requireSession, zValidator("param", IdParam), async (c) => {
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

    // If the encoder is mid-flight on this clip, SIGTERM ffmpeg and
    // wait for the handler to release its output file BEFORE we
    // unlink bytes. Otherwise ffmpeg would keep writing to the
    // now-unlinked inode, close after our cleanup, and leave either
    // nothing (lucky) or a zombie file in the pruned directory.
    await cancelEncode(id)

    // Wipe every key we could have produced for this clip — source,
    // encoded video, both thumbnails. delete() is no-op on missing.
    const keys = [
      row.storageKey,
      clipAssetKey(id, "video"),
      ...row.variants.map((variant) => variant.storageKey),
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
  })

  /**
   * GET /api/clips/:id/like — has the signed-in viewer already liked
   * this clip? Feeds the UI's initial "heart filled or hollow" state
   * when a clip detail opens — without this, a page refresh would lose
   * the liked look because the cached feed rows only carry the
   * aggregated `likeCount`, not a per-viewer flag.
   *
   * Signed-in only because "did user X like clip Y" needs a user id;
   * returns 401 for anon callers (the UI hides the like button there).
   */
  .get("/:id/like", requireSession, zValidator("param", IdParam), async (c) => {
    const viewerId = c.var.viewerId
    const { id } = c.req.valid("param")
    const [row] = await db
      .select({ clipId: clipLike.clipId })
      .from(clipLike)
      .where(and(eq(clipLike.clipId, id), eq(clipLike.userId, viewerId)))
      .limit(1)
    return c.json({ liked: row !== undefined })
  })

  /**
   * POST /api/clips/:id/like — idempotent like. Inserts a row into
   * `clip_like` with `onConflictDoNothing` (composite PK on
   * `(clipId, userId)` is what makes the insert idempotent). When the
   * insert actually added a row — i.e. the viewer hadn't liked it
   * before — we transactionally bump `clip.likeCount` so the feed's
   * aggregated count stays in sync without a COUNT(*) on read.
   *
   * Re-liking an already-liked clip is a no-op that still returns the
   * current state so the client doesn't have to special-case.
   */
  .post(
    "/:id/like",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      // Verify the clip exists before trying to insert. Without this
      // the FK constraint error would still 404 the client eventually,
      // but a clean up-front check gives a nicer error message and
      // keeps the transactional bump path obvious.
      const [target] = await db
        .select({ id: clip.id })
        .from(clip)
        .where(eq(clip.id, id))
        .limit(1)
      if (!target) return c.json({ error: "Not found" }, 404)

      const likeCount = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(clipLike)
          .values({ clipId: id, userId: viewerId })
          .onConflictDoNothing()
          .returning({ clipId: clipLike.clipId })
        // Only bump the counter if we actually wrote a new row —
        // otherwise a double-POST would double-count.
        if (inserted.length > 0) {
          const [row] = await tx
            .update(clip)
            .set({ likeCount: sql`${clip.likeCount} + 1` })
            .where(eq(clip.id, id))
            .returning({ likeCount: clip.likeCount })
          return row?.likeCount ?? 0
        }
        const [row] = await tx
          .select({ likeCount: clip.likeCount })
          .from(clip)
          .where(eq(clip.id, id))
          .limit(1)
        return row?.likeCount ?? 0
      })

      return c.json({ liked: true, likeCount })
    }
  )

  /**
   * DELETE /api/clips/:id/like — idempotent unlike. Mirror of the POST:
   * deletes the `clip_like` row and decrements `clip.likeCount` only
   * when a row was actually removed. Unliking a never-liked clip is a
   * no-op. The `GREATEST(0, ...)` guard is belt-and-suspenders — the
   * invariant above should keep the counter >= 0, but if it ever drifts
   * (hand-edited row, migration artefact) we'd rather stick at 0 than
   * flash a negative count in the UI.
   */
  .delete(
    "/:id/like",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")

      const likeCount = await db.transaction(async (tx) => {
        const removed = await tx
          .delete(clipLike)
          .where(and(eq(clipLike.clipId, id), eq(clipLike.userId, viewerId)))
          .returning({ clipId: clipLike.clipId })
        if (removed.length > 0) {
          const [row] = await tx
            .update(clip)
            .set({ likeCount: sql`GREATEST(0, ${clip.likeCount} - 1)` })
            .where(eq(clip.id, id))
            .returning({ likeCount: clip.likeCount })
          return row?.likeCount ?? 0
        }
        const [row] = await tx
          .select({ likeCount: clip.likeCount })
          .from(clip)
          .where(eq(clip.id, id))
          .limit(1)
        return row?.likeCount ?? 0
      })

      return c.json({ liked: false, likeCount })
    }
  )

  /**
   * POST /api/clips/:id/view — record a qualifying view. The client
   * calls this once per mount after the player has accumulated the
   * play-amount threshold (see `VideoPlayer.onPlayThreshold`); scrubbing
   * to the end doesn't trigger it because the threshold is measured in
   * cumulative-while-playing wall time, not currentTime position.
   *
   * Auth is optional: signed-in viewers are keyed by user id, anonymous
   * viewers by a signed cookie (see `lib/viewer-key.ts`). Both keyspaces
   * go through the same 24h dedup window in the `Cache`; pg only sees a
   * write when the cache says this is a fresh event.
   *
   * Own-clip views count on purpose — this is a self-hosted app and the
   * extra strictness of "don't count the author" isn't worth the
   * complexity. Clip still must be `ready` and not-private-to-the-viewer
   * (stream would 404/401 them otherwise, so the `/view` has to agree).
   */
  .post("/:id/view", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")

    const [row] = await db
      .select({
        id: clip.id,
        authorId: clip.authorId,
        status: clip.status,
        privacy: clip.privacy,
      })
      .from(clip)
      .where(eq(clip.id, id))
      .limit(1)
    if (!row) return c.json({ error: "Not found" }, 404)
    if (row.status !== "ready") return c.json({ error: "Not found" }, 404)

    const viewer = await resolveViewer(c)
    // Gate private clips the same way /stream does: author or admin can
    // view (and thus count a view); anyone else shouldn't be able to
    // record a view on a clip they can't legally play.
    if (row.privacy === "private") {
      const session = await getAuth().api.getSession({
        headers: c.req.raw.headers,
      })
      const isOwner = session?.user?.id === row.authorId
      const isAdmin =
        (session?.user as { role?: string | null } | undefined)?.role ===
        "admin"
      if (!isOwner && !isAdmin) {
        return session
          ? c.json({ error: "Forbidden" }, 403)
          : c.json({ error: "Unauthorized" }, 401)
      }
    }

    // Dedup key scoped per (clip, viewer). Cache errors don't take the
    // API down — log and skip the count. The stream still works.
    let counted = false
    try {
      counted = await cache.setIfAbsent(
        `view:${id}:${viewer.viewerKey}`,
        VIEW_DEDUP_TTL_SEC
      )
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[clips] cache setIfAbsent failed for view ${id}:`, err)
    }

    if (counted) {
      await db
        .update(clip)
        .set({ viewCount: sql`${clip.viewCount} + 1` })
        .where(eq(clip.id, id))
    }

    // Persist a freshly-minted anon cookie so the same viewer hashes to
    // the same key on their next hit. No-op when signed-in or when the
    // cookie was already valid.
    applyViewerCookie(c, viewer.cookieToSet)

    return c.body(null, 204)
  })

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

      const variant = findEncodedVariant(row, requestedVariant)
      if (!variant) {
        return c.json({ error: "Unknown quality" }, 404)
      }

      const resolved = await storage.resolve(variant.storageKey)
      if (!resolved) {
        // Status says ready but the bytes are missing — encoder lost
        // them, or the row was hand-edited. 404 plus a log; the reaper
        // is the right place to clean this up if it persists.
        // eslint-disable-next-line no-console
        console.error(
          `[clips] encoded bytes missing for ready clip ${id} (${variant.id})`
        )
        return c.json({ error: "Stream unavailable" }, 404)
      }

      const range = parseRange(c.req.header("range"), resolved.size)
      const contentType = variant.contentType || resolved.contentType
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
        headers["Content-Range"] =
          `bytes ${range.start}-${range.end}/${resolved.size}`
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
    }
  )

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
      return c.body(
        buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength
        ) as ArrayBuffer
      )
    }
  )

  /**
   * GET /api/clips/:id/download?variant=source|<encoded-id> — force a
   * download of either the original upload or one encoded rendition.
   * Privacy rules match playback. Encoded downloads require `ready`
   * bytes; owners/admins may still pull the original source while a
   * clip is mid-encode so they aren't locked out of their own upload.
   */
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
