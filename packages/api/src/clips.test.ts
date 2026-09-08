import assert from "node:assert/strict"

import type { AppType } from "@alloy/server/app"
import { hc } from "hono/client"
import { test } from "vite-plus/test"

import { createApiContext } from "./client"
import { createClipsApi } from "./clips"
import { HttpError } from "./http"

test("queue dismissal falls back only for missing endpoints and validates success", async () => {
  let response = Response.json({ success: true })
  const context = createApiContext({ baseURL: "https://alloy.example" })
  context.rpc = hc<AppType>(context.baseURL, {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        input,
        "https://alloy.example/api/clips/clip-id/queue-dismissal",
      )
      assert.equal(init?.method, "POST")
      return response
    },
  })
  const api = createClipsApi(context)
  assert.equal(await api.dismissQueue("clip-id"), true)
  response = new Response("404 Not Found", { status: 404 })
  assert.equal(await api.dismissQueue("clip-id"), false)
  for (const status of [401, 403, 500]) {
    response = Response.json({ error: "Request failed" }, { status })
    await assert.rejects(
      api.dismissQueue("clip-id"),
      (cause) => cause instanceof HttpError && cause.status === status,
    )
  }
  response = Response.json({ success: false })
  await assert.rejects(api.dismissQueue("clip-id"))
})
