import { createReadStream, existsSync, statSync } from "node:fs"
import { extname } from "node:path"
import { Readable } from "node:stream"
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web"
import { pathToFileURL } from "node:url"

import { net } from "electron"

import { exportedCaptureFiles } from "./recording-library-export"
import { findRecordingLibraryItem } from "./recording-library-scan"
import {
  EXPORT_HOST,
  MEDIA_HOST,
  MEDIA_PROTOCOL,
  THUMBNAIL_HOST,
} from "./recording-library-shared"
import {
  ensureCaptureBlurHash,
  ensureRecordingThumbnail,
} from "./recording-library-thumbnails"
import { mainSession } from "./session"

export function recordingLibraryProtocolScheme(): Electron.CustomScheme {
  return {
    scheme: MEDIA_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      // Without this, the scheme is missing from Chromium's CORS-enabled
      // scheme list and any cross-origin fetch() from the web app fails
      // outright with "Failed to fetch" — the request never reaches the
      // handler. The editor's mediabunny reader fetches capture bytes.
      corsEnabled: true,
    },
  }
}

let mediaProtocolRegistered = false

export function registerRecordingLibraryProtocol(): void {
  if (mediaProtocolRegistered) return
  mediaProtocolRegistered = true

  mainSession().protocol.handle(MEDIA_PROTOCOL, async (request) => {
    // The web app's editor reads captures with fetch() + Range headers
    // (mediabunny), which sends a cross-origin preflight first — media
    // elements skip it, fetch doesn't.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      })
    }

    const route = captureRouteFromUrl(request.url)
    if (!route) return new Response("Not found", { status: 404 })

    const item =
      route.kind === "export" ? null : findRecordingLibraryItem(route.id)

    if (route.kind === "export") {
      const filename = exportedCaptureFiles.get(route.id)
      if (!filename || !existsSync(filename)) {
        return new Response("Not found", { status: 404 })
      }
      return rangedFileResponse(filename, request)
    }

    if (!item) return new Response("Not found", { status: 404 })

    if (route.kind === "thumbnail") {
      const thumbnail = await ensureRecordingThumbnail(item)
      if (!thumbnail) return new Response("Not found", { status: 404 })
      // The thumbnail bytes are already on disk; derive the BlurHash off the
      // request path so the next library snapshot can ship a placeholder.
      void ensureCaptureBlurHash(item)
      return net.fetch(pathToFileURL(thumbnail).toString())
    }

    // Screenshots are their own thumbnail, so the first media request is the
    // natural point to derive their BlurHash.
    if (item.kind === "screenshot") void ensureCaptureBlurHash(item)
    return rangedFileResponse(item.filename, request)
  })
}

const CAPTURE_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

/**
 * Bridges a Node file stream to the DOM-typed `ReadableStream` that
 * `Response` accepts. `Readable.toWeb` returns the structurally identical
 * `node:stream/web` variant, so a single targeted assertion is enough.
 */
function fileBodyStream(stream: Readable): ReadableStream<Uint8Array> {
  const webStream: NodeWebReadableStream<Uint8Array> = Readable.toWeb(stream)
  return webStream as ReadableStream<Uint8Array>
}

/**
 * Serves a capture file with HTTP Range support. `net.fetch(file://…)`
 * ignores Range headers, so every seek of Chromium's media element (and the
 * editor's filmstrip sampler) would restart a full-file stream — large
 * captures stall and the element eventually gives up with
 * MEDIA_ERR_SRC_NOT_SUPPORTED.
 */
function rangedFileResponse(filename: string, request: Request): Response {
  let size: number
  try {
    size = statSync(filename).size
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type":
      CAPTURE_CONTENT_TYPES[extname(filename).toLowerCase()] ??
      "application/octet-stream",
    // The renderer runs on a different origin than this protocol. The trim
    // editor samples frames into a canvas, and reading those pixels back is
    // only allowed when the media was fetched via CORS.
    "Access-Control-Allow-Origin": "*",
    // fetch()-based readers (mediabunny) size the file off these headers.
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges",
  }

  const range =
    parseByteRange(request.headers.get("range"), size) ??
    parseQueryByteRange(request.url, size)
  if (range) {
    headers["Content-Length"] = String(range.end - range.start + 1)
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`
  } else {
    headers["Content-Length"] = String(size)
  }

  const stream = createReadStream(
    filename,
    range ? { start: range.start, end: range.end } : undefined,
  )
  return new Response(fileBodyStream(stream), {
    status: range ? 206 : 200,
    headers,
  })
}

/**
 * Range requested as `?range=start-end` (inclusive), an alternative to the
 * Range header. The editor's mediabunny reader uses this because a custom
 * request header forces a CORS preflight on cross-origin fetches to this
 * scheme, while a plain GET sails through with the existing CORS headers.
 */
function parseQueryByteRange(
  rawUrl: string,
  size: number,
): { start: number; end: number } | null {
  if (size <= 0) return null
  let value: string | null
  try {
    value = new URL(rawUrl).searchParams.get("range")
  } catch {
    return null
  }
  if (!value) return null
  const match = /^(\d+)-(\d+)$/.exec(value)
  if (!match) return null
  const start = Number(match[1])
  const end = Math.min(Number(match[2]), size - 1)
  if (!Number.isFinite(start) || start >= size || end < start) return null
  return { start, end }
}

/** Parses a single-range `Range` header; anything else falls back to 200. */
function parseByteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, startText, endText] = match

  if (!startText) {
    // Suffix range: the final N bytes.
    const suffix = Number(endText)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    const start = Math.max(0, size - suffix)
    return { start, end: size - 1 }
  }

  const start = Number(startText)
  if (!Number.isFinite(start) || start >= size) return null
  const end = endText ? Math.min(Number(endText), size - 1) : size - 1
  if (!Number.isFinite(end) || end < start) return null
  return { start, end }
}

interface CaptureRoute {
  kind: "media" | "thumbnail" | "export"
  id: string
}

function captureRouteFromUrl(rawUrl: string): CaptureRoute | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${MEDIA_PROTOCOL}:`) return null

    const kind =
      url.hostname === MEDIA_HOST
        ? "media"
        : url.hostname === THUMBNAIL_HOST
          ? "thumbnail"
          : url.hostname === EXPORT_HOST
            ? "export"
            : null
    if (!kind) return null
    const id = url.pathname.replace(/^\/+/, "")
    return /^[A-Za-z0-9_-]{12,64}$/.test(id) ? { kind, id } : null
  } catch {
    return null
  }
}
