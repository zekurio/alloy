import type { ClipPrivacy } from "@alloy/contracts"
import { notFound } from "@alloy/server/runtime/http-response"
import { pipeReadable } from "@alloy/server/runtime/streaming"
import { clipStorage } from "@alloy/server/storage/index"
import { type Context } from "hono"
import { stream } from "hono/streaming"

import { parseRange, readAll } from "./clips-helpers"

type ResolvedStorageObject = NonNullable<
  Awaited<ReturnType<typeof clipStorage.resolve>>
>

export function mediaCacheControl(privacy: ClipPrivacy): string {
  return privacy === "public" ? "public, max-age=300" : "private, max-age=300"
}

export function streamResolved(
  c: Context,
  resolved: ResolvedStorageObject,
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

export async function streamThumbnail(
  c: Context,
  key: string,
  cacheControl: string,
): Promise<Response> {
  const resolved = await clipStorage.resolve(key)
  if (!resolved) return notFound(c, "No thumbnail")

  c.header("Content-Type", resolved.contentType)
  c.header("Content-Length", String(resolved.size))
  c.header("Cache-Control", cacheControl)
  if (c.req.method === "HEAD") return c.body(null)

  const buf = await readAll(resolved.stream())
  return c.body(
    buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer,
  )
}
