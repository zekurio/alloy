import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import test from "node:test"

import type { StorageDriver } from "@alloy/server/storage/driver"

import { immutableImageAssetsRoute } from "./immutable-image-assets"

const KEY = "ab/cd/00000000-0000-0000-0000-000000000000/avatar.webp"
const KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f-]+\/avatar\.webp$/i

test("immutableImageAssetsRoute rejects invalid and missing keys", async () => {
  const storage: Pick<StorageDriver, "resolve"> = {
    resolve: async () => null,
  }
  const route = immutableImageAssetsRoute(storage, KEY_PATTERN)

  assert.equal((await route.request("/invalid.webp")).status, 404)
  assert.equal((await route.request(`/${KEY}`)).status, 404)
})

test("immutableImageAssetsRoute serves bytes and immutable metadata", async () => {
  const bytes = Buffer.from([1, 2, 3, 4, 5])
  const lastModified = new Date("2026-07-22T10:00:00.000Z")
  const storage: Pick<StorageDriver, "resolve"> = {
    resolve: async () => ({
      size: bytes.byteLength,
      contentType: "image/webp",
      lastModified,
      stream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 2))
            controller.enqueue(bytes.subarray(2))
            controller.close()
          },
        }),
    }),
  }
  const response = await immutableImageAssetsRoute(
    storage,
    KEY_PATTERN,
  ).request(`/${KEY}`)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "image/webp")
  assert.equal(response.headers.get("content-length"), "5")
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=86400, immutable",
  )
  assert.equal(
    response.headers.get("last-modified"),
    lastModified.toUTCString(),
  )
  assert.equal(
    response.headers.get("etag"),
    `"${Buffer.from(`${KEY}:5:${lastModified.getTime()}`).toString(
      "base64url",
    )}"`,
  )
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
})

test("immutableImageAssetsRoute honors If-None-Match without reading bytes", async () => {
  const state = { streamCalls: 0 }
  const storage: Pick<StorageDriver, "resolve"> = {
    resolve: async () => ({
      size: 5,
      contentType: "image/webp",
      lastModified: null,
      stream: () => {
        state.streamCalls += 1
        return new ReadableStream()
      },
    }),
  }
  const route = immutableImageAssetsRoute(storage, KEY_PATTERN)
  const etag = `"${Buffer.from(`${KEY}:5:0`).toString("base64url")}"`
  const response = await route.request(`/${KEY}`, {
    headers: { "If-None-Match": etag },
  })

  assert.equal(response.status, 304)
  assert.equal(response.headers.get("etag"), etag)
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=86400, immutable",
  )
  assert.equal(response.headers.get("content-type"), null)
  assert.equal(state.streamCalls, 0)
})
