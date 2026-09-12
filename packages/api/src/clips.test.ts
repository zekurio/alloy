import assert from "node:assert/strict"

import type { AppType } from "@alloy/server/app"
import { hc } from "hono/client"
import { test } from "vite-plus/test"

import { createApiContext } from "./client"
import { createClipsApi } from "./clips"
import { HttpError } from "./http"

test("queue dismissal requires server persistence and validates success", async () => {
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
  assert.equal(await api.dismissQueue("clip-id"), undefined)
  for (const status of [401, 403, 404, 500]) {
    response = Response.json({ error: "Request failed" }, { status })
    await assert.rejects(
      api.dismissQueue("clip-id"),
      (cause) => cause instanceof HttpError && cause.status === status,
    )
  }
  response = Response.json({ success: false })
  await assert.rejects(api.dismissQueue("clip-id"))
})
