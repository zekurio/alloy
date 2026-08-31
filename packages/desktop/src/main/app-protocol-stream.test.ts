import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"

import { test } from "vite-plus/test"

import {
  proxyResponseBody,
  responseHeaderDeadline,
} from "./app-protocol-stream"

test("response header deadline ends with headers and preserves request aborts", async () => {
  const request = new AbortController()
  const cleared = responseHeaderDeadline(request.signal, 0)
  cleared.clear()
  await delay(5)
  assert.equal(cleared.signal.aborted, false)

  const reason = new Error("request ended")
  request.abort(reason)
  assert.equal(cleared.signal.aborted, true)
  assert.equal(cleared.signal.reason, reason)
  assert.equal(cleared.timedOut(), false)

  const expired = responseHeaderDeadline(new AbortController().signal, 0)
  await new Promise<void>((resolve) =>
    expired.signal.addEventListener("abort", () => resolve(), { once: true }),
  )
  assert.equal(expired.timedOut(), true)
  expired.clear()
})

test("proxy response body cancels its upstream reader", async () => {
  let downstreamCancellation: object | null = null
  const upstream = new ReadableStream<Uint8Array>({
    cancel(reason) {
      downstreamCancellation = reason
    },
  })
  const proxied = proxyResponseBody(upstream, new AbortController().signal)
  assert.ok(proxied)

  const downstreamReason = new Error("renderer stopped reading")
  await proxied.cancel(downstreamReason)
  assert.equal(downstreamCancellation, downstreamReason)

  let requestCancellation: object | null = null
  const request = new AbortController()
  const pendingUpstream = new ReadableStream<Uint8Array>({
    cancel(reason) {
      requestCancellation = reason
    },
  })
  const pendingProxy = proxyResponseBody(pendingUpstream, request.signal)
  assert.ok(pendingProxy)
  const reader = pendingProxy.getReader()
  const read = reader.read()
  const requestReason = new Error("request aborted")
  request.abort(requestReason)

  await assert.rejects(read, requestReason)
  assert.equal(requestCancellation, requestReason)
})
