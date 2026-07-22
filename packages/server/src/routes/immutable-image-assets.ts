import { Buffer } from "node:buffer"

import { ifNoneMatchSatisfied } from "@alloy/server/runtime/http-conditional"
import { notFound } from "@alloy/server/runtime/http-response"
import type {
  ResolvedObject,
  StorageDriver,
} from "@alloy/server/storage/driver"
import { Hono } from "hono"

export function immutableImageAssetsRoute(
  storage: Pick<StorageDriver, "resolve">,
  keyPattern: RegExp,
) {
  return new Hono().get("/:key{.+}", async (c) => {
    const key = c.req.param("key") ?? ""
    if (!key || !keyPattern.test(key)) return notFound(c)

    const resolved = await storage.resolve(key)
    if (!resolved) return notFound(c)
    const etag = assetEtag(key, resolved)

    c.header("ETag", etag)
    if (resolved.lastModified) {
      c.header("Last-Modified", resolved.lastModified.toUTCString())
    }
    c.header("Cache-Control", "public, max-age=86400, immutable")

    if (ifNoneMatchSatisfied(c.req.header("if-none-match"), etag)) {
      return c.body(null, 304)
    }

    c.header("Content-Type", resolved.contentType)
    const buffer = await readAll(resolved.stream())
    c.header("Content-Length", String(buffer.byteLength))

    return c.body(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    )
  })
}

function assetEtag(key: string, resolved: ResolvedObject): string {
  const modified = resolved.lastModified?.getTime() ?? 0
  return `"${Buffer.from(`${key}:${resolved.size}:${modified}`).toString(
    "base64url",
  )}"`
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const output = Buffer.alloc(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
