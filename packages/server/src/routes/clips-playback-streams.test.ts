import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { type TestContext } from "node:test"

import { FsStorageDriver } from "@alloy/server/storage/fs-driver"
import { Hono } from "hono"

import { streamResolved } from "./clips-playback-streams"

const bytes = new TextEncoder().encode("0123456789")
const etag = '"src-test"'
const cacheControl = "public, max-age=300"

async function streamApp(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "alloy-stream-"))
  t.after(() => rm(root, { recursive: true, force: true }))

  const driver = new FsStorageDriver({
    root,
    publicBaseUrl: "http://localhost:2552",
    hmacSecret: "0123456789abcdef0123456789abcdef",
  })
  await driver.put("clip.mp4", bytes, "video/mp4")

  const app = new Hono()
  app.on(["GET", "HEAD"], "/stream", async (c) => {
    const resolved = await driver.resolve("clip.mp4")
    if (!resolved) return c.body(null, 404)

    return streamResolved(c, resolved, "video/mp4", cacheControl, { etag })
  })

  const resolved = await driver.resolve("clip.mp4")
  assert.ok(resolved?.lastModified)

  return {
    app,
    lastModified: resolved.lastModified.toUTCString(),
  }
}

test("streamResolved serves satisfiable ranges with validators", async (t) => {
  const state = await streamApp(t)
  const response = await state.app.request("/stream", {
    headers: { Range: "bytes=2-5" },
  })

  assert.equal(response.status, 206)
  assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10")
  assert.equal(response.headers.get("Content-Length"), "4")
  assert.equal(response.headers.get("ETag"), etag)
  assert.equal(response.headers.get("Last-Modified"), state.lastModified)
  assert.equal(response.headers.get("Accept-Ranges"), "bytes")
  assert.equal(response.headers.get("Cache-Control"), cacheControl)
  assert.equal(await response.text(), "2345")
})

test("streamResolved returns 304 for matching If-None-Match", async (t) => {
  const state = await streamApp(t)
  const response = await state.app.request("/stream", {
    headers: { "If-None-Match": etag },
  })

  assert.equal(response.status, 304)
  assert.equal(response.headers.get("ETag"), etag)
  assert.equal(response.headers.get("Last-Modified"), state.lastModified)
  assert.equal(response.headers.get("Content-Length"), null)
  assert.equal(response.headers.get("Content-Range"), null)
  assert.equal(await response.text(), "")
})

test("streamResolved returns 304 before evaluating Range", async (t) => {
  const state = await streamApp(t)
  const response = await state.app.request("/stream", {
    headers: {
      "If-None-Match": etag,
      Range: "bytes=2-5",
    },
  })

  assert.equal(response.status, 304)
  assert.equal(response.headers.get("ETag"), etag)
  assert.equal(response.headers.get("Last-Modified"), state.lastModified)
  assert.equal(response.headers.get("Content-Length"), null)
  assert.equal(response.headers.get("Content-Range"), null)
  assert.equal(await response.text(), "")
})

test("streamResolved ignores Range when If-Range has stale ETag", async (t) => {
  const state = await streamApp(t)
  const response = await state.app.request("/stream", {
    headers: {
      "If-Range": '"src-stale"',
      Range: "bytes=2-5",
    },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Content-Length"), "10")
  assert.equal(response.headers.get("Content-Range"), null)
  assert.equal(response.headers.get("ETag"), etag)
  assert.equal(response.headers.get("Last-Modified"), state.lastModified)
  assert.equal(await response.text(), "0123456789")
})

test("streamResolved honors Range when If-Range has matching ETag", async (t) => {
  const state = await streamApp(t)
  const response = await state.app.request("/stream", {
    headers: {
      "If-Range": etag,
      Range: "bytes=2-5",
    },
  })

  assert.equal(response.status, 206)
  assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10")
  assert.equal(response.headers.get("ETag"), etag)
  assert.equal(response.headers.get("Last-Modified"), state.lastModified)
  assert.equal(await response.text(), "2345")
})

test("streamResolved honors Range when If-Range has matching Last-Modified", async (t) => {
  const state = await streamApp(t)
  const response = await state.app.request("/stream", {
    headers: {
      "If-Range": state.lastModified,
      Range: "bytes=2-5",
    },
  })

  assert.equal(response.status, 206)
  assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10")
  assert.equal(response.headers.get("ETag"), etag)
  assert.equal(response.headers.get("Last-Modified"), state.lastModified)
  assert.equal(await response.text(), "2345")
})

test("streamResolved serves HEAD ranges with headers and no body", async (t) => {
  const state = await streamApp(t)
  const response = await state.app.request("/stream", {
    method: "HEAD",
    headers: { Range: "bytes=2-5" },
  })

  assert.equal(response.status, 206)
  assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10")
  assert.equal(response.headers.get("Content-Length"), "4")
  assert.equal(response.headers.get("ETag"), etag)
  assert.equal(response.headers.get("Last-Modified"), state.lastModified)
  assert.equal(await response.text(), "")
})

test("streamResolved includes validators on unsatisfiable ranges", async (t) => {
  const state = await streamApp(t)
  const response = await state.app.request("/stream", {
    headers: { Range: "bytes=10-" },
  })

  assert.equal(response.status, 416)
  assert.equal(response.headers.get("Content-Range"), "bytes */10")
  assert.equal(response.headers.get("ETag"), etag)
  assert.equal(response.headers.get("Last-Modified"), state.lastModified)
  assert.equal(await response.text(), "")
})
