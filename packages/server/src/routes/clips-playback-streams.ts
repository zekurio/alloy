import type { ClipPrivacy } from "@alloy/contracts"
import { ifNoneMatchSatisfied } from "@alloy/server/runtime/http-conditional"
import { notFound } from "@alloy/server/runtime/http-response"
import { pipeReadable } from "@alloy/server/runtime/streaming"
import type {
  ResolvedObject,
  StorageDriver,
} from "@alloy/server/storage/driver"
import { type Context } from "hono"
import { stream } from "hono/streaming"

import { parseRange } from "./clips-range"

export function mediaCacheControl(privacy: ClipPrivacy): string {
  return privacy === "public" ? "public, max-age=300" : "private, max-age=300"
}

export function streamResolved(
  c: Context,
  resolved: ResolvedObject,
  contentType: string,
  cacheControl: string,
  conditional?: { etag: string },
): Response {
  const lastModified = resolved.lastModified?.toUTCString()
  setStreamHeaders(c, cacheControl, conditional, lastModified)

  if (
    conditional &&
    ifNoneMatchSatisfied(c.req.header("if-none-match"), conditional.etag)
  ) {
    return c.body(null, 304)
  }

  const rangeHeader = c.req.header("range")
  const range = parseRange(
    rangeHonored(
      c.req.header("if-range"),
      rangeHeader,
      conditional,
      lastModified,
    )
      ? rangeHeader
      : undefined,
    resolved.size,
  )
  if (range.kind === "range") {
    const length = range.end - range.start + 1
    const body = resolved.stream({ start: range.start, end: range.end })
    c.header("Content-Type", contentType)
    c.header(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${resolved.size}`,
    )
    c.header("Content-Length", String(length))
    c.status(206)
    if (c.req.method === "HEAD") return c.body(null)
    return stream(c, async (s) => {
      await pipeReadable(s, body)
    })
  }
  if (range.kind === "unsatisfiable") {
    c.header("Content-Range", `bytes */${resolved.size}`)
    return c.body(null, 416)
  }

  const body = resolved.stream()
  c.header("Content-Type", contentType)
  c.header("Content-Length", String(resolved.size))
  if (c.req.method === "HEAD") return c.body(null)
  return stream(c, async (s) => {
    await pipeReadable(s, body)
  })
}

export async function streamThumbnail(
  c: Context,
  storage: StorageDriver,
  key: string,
  cacheControl: string,
): Promise<Response> {
  const resolved = await storage.resolve(key)
  if (!resolved) return notFound(c, "No thumbnail")

  c.header("Content-Type", resolved.contentType)
  c.header("Content-Length", String(resolved.size))
  c.header("Cache-Control", cacheControl)
  if (c.req.method === "HEAD") return c.body(null)

  return stream(c, async (s) => {
    await pipeReadable(s, resolved.stream())
  })
}

function setStreamHeaders(
  c: Context,
  cacheControl: string,
  conditional: { etag: string } | undefined,
  lastModified: string | undefined,
) {
  c.header("Accept-Ranges", "bytes")
  c.header("Cache-Control", cacheControl)
  if (conditional) c.header("ETag", conditional.etag)
  if (lastModified) c.header("Last-Modified", lastModified)
}

function rangeHonored(
  ifRange: string | undefined,
  rangeHeader: string | undefined,
  conditional: { etag: string } | undefined,
  lastModified: string | undefined,
) {
  if (!rangeHeader) return false
  if (!ifRange) return true

  const validator = ifRange.trim()
  if (conditional && validator === conditional.etag) return true
  if (lastModified && validator === lastModified) return true

  // A stale If-Range validator means the client's partial copy came from different bytes.
  return false
}
