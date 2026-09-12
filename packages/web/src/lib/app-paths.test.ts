import assert from "node:assert/strict"

import { clipShareUrl } from "@alloy/contracts"
import { test } from "vite-plus/test"

import { absoluteClipHref } from "./app-paths"

test("shared clip links carry a fresh timestamp", () => {
  const before = Date.now()
  const url = new URL(
    absoluteClipHref("halo", "clip-1", "https://alloy.example"),
  )
  const timestamp = Number(url.searchParams.get("t"))
  assert.equal(url.pathname, "/games/halo/clips/clip-1")
  assert.ok(timestamp >= before && timestamp <= Date.now())
  assert.equal(
    clipShareUrl("clip-1", url.origin, timestamp),
    `https://alloy.example/clips/clip-1?t=${timestamp}`,
  )
})
