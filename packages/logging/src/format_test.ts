import assert from "node:assert/strict"
import { test } from "node:test"

import { formatLine } from "./index"

const timestamp = new Date("2026-06-11T14:03:22.117Z")

test("formatLine emits timestamp, level, joined args, and sorted context", () => {
  const line = formatLine(
    "INFO",
    ["[clips]", "republished", { count: 2 }],
    { req: "k3f9a2c1", clip: "clip-1" },
    timestamp,
    "human",
  )

  assert.equal(
    line,
    "2026-06-11T14:03:22.117Z INFO  [clips] republished { count: 2 } clip=clip-1 req=k3f9a2c1",
  )
})

test("formatLine keeps Error stack text in the message", () => {
  const err = new Error("boom")
  err.stack = "Error: boom\n    at test"

  const line = formatLine("ERROR", ["[api]", err], {}, timestamp, "human")

  assert.equal(
    line,
    "2026-06-11T14:03:22.117Z ERROR [api] Error: boom\n    at test",
  )
})

test("formatLine emits parseable JSON with context fields merged", () => {
  const line = formatLine(
    "WARN",
    ["[queue]", { stage: "publish" }],
    { clip: "clip-1", run: "run-1" },
    timestamp,
    "json",
  )

  assert.deepEqual(JSON.parse(line), {
    ts: "2026-06-11T14:03:22.117Z",
    level: "WARN",
    msg: "[queue] { stage: 'publish' }",
    clip: "clip-1",
    run: "run-1",
  })
})
