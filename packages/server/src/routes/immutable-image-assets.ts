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
    c.header("Content-Length", String(resolved.size))
    if (c.req.method === "HEAD") return c.body(null)
    return c.body(resolved.stream())
  })
}

function assetEtag(key: string, resolved: ResolvedObject): string {
  const modified = resolved.lastModified?.getTime() ?? 0
  return `"${Buffer.from(`${key}:${resolved.size}:${modified}`).toString(
    "base64url",
  )}"`
}
