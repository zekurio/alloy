import { zValidator } from "./validation"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { logger } from "@workspace/logging"

import {
  applyClipPrivacyHeaders,
  clipAccessResponse,
  resolveClipAccess,
} from "../clips/access"
import { storage } from "../storage"
import { notFound } from "../runtime/http-response"
import { pipeReadable } from "../runtime/streaming"
import {
  buildHlsMasterPlaylist,
  contentDisposition,
  downloadFilename,
  DownloadQuery,
  findEncodedVariant,
  HlsVariantParam,
  IdParam,
  parseRange,
  readAll,
  StreamQuery,
} from "./clips-helpers"
import type { Context } from "hono"
import type { ClipPrivacy } from "@workspace/contracts"

/** Cache-Control for playback bytes/manifests, keyed on clip privacy. */
function mediaCacheControl(privacy: ClipPrivacy): string {
  return privacy === "public"
    ? "public, max-age=300"
    : privacy === "private"
    ? "no-store"
    : "private, max-age=300"
}

/** Stream an already-resolved object, honouring an optional `Range` request.
 *  Never redirects, so it is safe for hls.js segment fetches (same-origin). */
function streamResolved(
  c: Context,
  resolved: NonNullable<Awaited<ReturnType<typeof storage.resolve>>>,
  contentType: string,
  cacheControl: string,
): Response {
  const range = parseRange(c.req.header("range"), resolved.size)
  if (range) {
    const length = range.end - range.start + 1
    const body = resolved.stream({ start: range.start, end: range.end })
    c.header("Content-Type", contentType)
    c.header(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${resolved.size}`,
    )
    c.header("Content-Length", String(length))
    c.header("Accept-Ranges", "bytes")
    c.header("Cache-Control", cacheControl)
    c.status(206)
    if (c.req.method === "HEAD") return c.body(null)
    return stream(c, async (s) => {
      await pipeReadable(s, body)
    })
  }

  const body = resolved.stream()
  c.header("Content-Type", contentType)
  c.header("Content-Length", String(resolved.size))
  c.header("Accept-Ranges", "bytes")
  c.header("Cache-Control", cacheControl)
  if (c.req.method === "HEAD") return c.body(null)
  return stream(c, async (s) => {
    await pipeReadable(s, body)
  })
}

export const clipsPlaybackRoutes = new Hono()
  .get(
    "/:id/stream",
    zValidator("param", IdParam),
    zValidator("query", StreamQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { variant: requestedVariant } = c.req.valid("query")
      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "stream",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      applyClipPrivacyHeaders(c, access)
      const row = access.row

      const variant = requestedVariant === "source"
        ? null
        : findEncodedVariant(row, requestedVariant)
      const selected = requestedVariant === "source"
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
        return notFound(c, "Unknown quality")
      }

      const cacheControl = mediaCacheControl(row.privacy)

      if (!access.isPrivate && c.req.method !== "HEAD") {
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
        logger.error(
          `[clips] bytes missing for ready clip ${id} (${selected.id})`,
        )
        return notFound(c, "Stream unavailable")
      }

      return streamResolved(
        c,
        resolved,
        selected.contentType || resolved.contentType,
        cacheControl,
      )
    },
  )
  /**
   * HLS master playlist — lists every CMAF rendition with the BANDWIDTH/CODECS
   * line ffmpeg computed at encode time. Synthesized on demand; nothing extra
   * is stored. Returns 404 for clips encoded before HLS existed, so the player
   * falls back to progressive `/stream`.
   */
  .get("/:id/hls/master.m3u8", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      headers: c.req.raw.headers,
      policy: "stream",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    applyClipPrivacyHeaders(c, access)
    const row = access.row

    const master = buildHlsMasterPlaylist(row.variants)
    if (!master) return notFound(c, "HLS unavailable")

    c.header("Content-Type", "application/vnd.apple.mpegurl")
    c.header("Cache-Control", mediaCacheControl(row.privacy))
    if (c.req.method === "HEAD") return c.body(null)
    return c.body(master)
  })
  /** HLS media playlist for one rendition — the byte-range playlist ffmpeg
   *  produced, served verbatim. Its `media.m4s` references resolve to the
   *  sibling media route below. */
  .get(
    "/:id/hls/:variant/playlist.m3u8",
    zValidator("param", HlsVariantParam),
    async (c) => {
      const { id, variant: variantId } = c.req.valid("param")
      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "stream",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      applyClipPrivacyHeaders(c, access)

      const variant = access.row.variants.find(
        (candidate) => candidate.id === variantId && candidate.hls,
      )
      if (!variant?.hls) return notFound(c, "HLS variant unavailable")

      c.header("Content-Type", "application/vnd.apple.mpegurl")
      c.header("Cache-Control", mediaCacheControl(access.row.privacy))
      if (c.req.method === "HEAD") return c.body(null)
      return c.body(variant.hls.playlist)
    },
  )
  /** HLS media segments — byte ranges of the single CMAF file. Always streamed
   *  same-origin (never redirected) so hls.js fetches aren't blocked by the
   *  storage backend's cross-origin policy. */
  .get(
    "/:id/hls/:variant/media.m4s",
    zValidator("param", HlsVariantParam),
    async (c) => {
      const { id, variant: variantId } = c.req.valid("param")
      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "stream",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      applyClipPrivacyHeaders(c, access)

      const variant = access.row.variants.find(
        (candidate) => candidate.id === variantId && candidate.hls,
      )
      if (!variant) return notFound(c, "HLS media unavailable")

      const resolved = await storage.resolve(variant.storageKey)
      if (!resolved) return notFound(c, "HLS media unavailable")

      return streamResolved(
        c,
        resolved,
        "video/mp4",
        mediaCacheControl(access.row.privacy),
      )
    },
  )
  /**
   * GET /api/clips/:id/thumbnail — poster image for the player and
   * queue/grid cards. Returns 404 when the encoder couldn't produce
   * one (intentional — the UI falls back to a gradient placeholder,
   * which it does for unencoded clips too).
   */
  .get("/:id/thumbnail", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")

    const access = await resolveClipAccess({
      id,
      headers: c.req.raw.headers,
      policy: "ownerAsset",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    applyClipPrivacyHeaders(c, access)
    const row = access.row

    const key = row.thumbKey
    if (!key) return notFound(c, "No thumbnail")

    const thumbCacheControl = row.privacy === "public" && row.status === "ready"
      ? "public, max-age=86400"
      : row.privacy === "private"
      ? "no-store"
      : "private, max-age=86400"

    if (!access.isPrivate && c.req.method !== "HEAD") {
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
    if (!resolved) return notFound(c, "No thumbnail")

    c.header("Content-Type", resolved.contentType)
    c.header("Content-Length", String(resolved.size))
    c.header("Cache-Control", thumbCacheControl)
    if (c.req.method === "HEAD") return c.body(null)

    const buf = await readAll(resolved.stream())
    return c.body(
      buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer,
    )
  })
  .get("/:id/opengraph", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const access = await resolveClipAccess({
      id,
      headers: c.req.raw.headers,
      policy: "openGraphAsset",
    })
    if (!access.accessible) return clipAccessResponse(c, access)
    const row = access.row

    if (!row.openGraphKey) {
      return notFound(c)
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
    if (!resolved) return notFound(c, "OpenGraph unavailable")
    c.header("Content-Type", row.openGraphContentType ?? resolved.contentType)
    c.header("Content-Length", String(resolved.size))
    c.header("Accept-Ranges", "bytes")
    c.header("Cache-Control", "public, max-age=300")
    if (c.req.method === "HEAD") return c.body(null)
    const body = resolved.stream()
    return stream(c, async (s) => {
      await pipeReadable(s, body)
    })
  })
  .get(
    "/:id/download",
    zValidator("param", IdParam),
    zValidator("query", DownloadQuery),
    async (c) => {
      const { id } = c.req.valid("param")
      const { variant: requestedVariant } = c.req.valid("query")

      const access = await resolveClipAccess({
        id,
        headers: c.req.raw.headers,
        policy: "ownerAsset",
      })
      if (!access.accessible) return clipAccessResponse(c, access)
      applyClipPrivacyHeaders(c, access)
      const row = access.row

      const encodedVariant =
        row.status === "ready" && requestedVariant !== "source"
          ? findEncodedVariant(row, requestedVariant)
          : null
      const selected = requestedVariant === "source"
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
        return notFound(c, "Unknown download variant")
      }

      const dlCacheControl = row.privacy === "public"
        ? "public, max-age=300"
        : row.privacy === "private"
        ? "no-store"
        : "private, max-age=300"

      if (!access.isPrivate && c.req.method !== "HEAD") {
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
        return notFound(c, "Download unavailable")
      }

      c.header("Content-Type", selected.contentType || resolved.contentType)
      c.header("Content-Length", String(resolved.size))
      c.header("Content-Disposition", contentDisposition(selected.filename))
      c.header("Cache-Control", dlCacheControl)
      if (c.req.method === "HEAD") return c.body(null)

      const body = resolved.stream()
      return stream(c, async (s) => {
        await pipeReadable(s, body)
      })
    },
  )
