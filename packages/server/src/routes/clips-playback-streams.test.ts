import assert from "node:assert/strict"

import { Hono } from "hono"
import { test } from "vite-plus/test"

import type { ResolvedObject } from "../storage/driver"
import { mediaCacheControl, streamResolved } from "./clips-playback-streams"

const bytes = new TextEncoder().encode("0123456789")
const etag = '"src-current"'

const resolved: ResolvedObject = {
  size: bytes.byteLength,
  contentType: "video/mp4",
  lastModified: null,
  stream: (range) => {
    const start = range?.start ?? 0
    const end = range?.end ?? bytes.byteLength - 1
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(start, end + 1))
        controller.close()
      },
    })
  },
}

test("clip media caches must revalidate every privacy class", () => {
  assert.equal(mediaCacheControl("public"), "public, no-cache, must-revalidate")
  assert.equal(
    mediaCacheControl("unlisted"),
    "private, no-cache, must-revalidate",
  )
  assert.equal(
    mediaCacheControl("private"),
    "private, no-cache, must-revalidate",
  )
})

test("cache revalidation keeps byte ranges and ETags", async () => {
  const app = new Hono().get("/media", (c) =>
    streamResolved(
      c,
      resolved,
      resolved.contentType,
      mediaCacheControl("public"),
      { etag },
    ),
  )

  const fullResponse = await app.request("/media")
  assert.equal(fullResponse.status, 200)
  assert.equal(await fullResponse.text(), "0123456789")

  const rangeResponse = await app.request("/media", {
    headers: { Range: "bytes=2-5" },
  })
  assert.equal(rangeResponse.status, 206)
  assert.equal(
    rangeResponse.headers.get("Cache-Control"),
    "public, no-cache, must-revalidate",
  )
  assert.equal(rangeResponse.headers.get("ETag"), etag)
  assert.equal(rangeResponse.headers.get("Content-Range"), "bytes 2-5/10")
  assert.equal(await rangeResponse.text(), "2345")

  const validationResponse = await app.request("/media", {
    headers: { "If-None-Match": etag },
  })
  assert.equal(validationResponse.status, 304)
  assert.equal(
    validationResponse.headers.get("Cache-Control"),
    "public, no-cache, must-revalidate",
  )
  assert.equal(validationResponse.headers.get("ETag"), etag)
})
