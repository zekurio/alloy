import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"

import { getLogContext, runWithLogContext } from "./context"

test("getLogContext returns an empty object outside a context", () => {
  assert.deepEqual(getLogContext(), {})
})

test("log context survives awaits and timers", async () => {
  await runWithLogContext({ req: "abc123" }, async () => {
    await Promise.resolve()
    assert.deepEqual(getLogContext(), { req: "abc123" })

    await delay(1)
    assert.deepEqual(getLogContext(), { req: "abc123" })
  })
})

test("nested log contexts merge and restore on exit", () => {
  runWithLogContext({ req: "outer", clip: "clip-1" }, () => {
    assert.deepEqual(getLogContext(), { req: "outer", clip: "clip-1" })

    runWithLogContext({ req: "inner", run: "run-1" }, () => {
      assert.deepEqual(getLogContext(), {
        req: "inner",
        clip: "clip-1",
        run: "run-1",
      })
    })

    assert.deepEqual(getLogContext(), { req: "outer", clip: "clip-1" })
  })

  assert.deepEqual(getLogContext(), {})
})
