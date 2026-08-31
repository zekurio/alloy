import assert from "node:assert/strict"

import type { ClipRow } from "@alloy/api"
import { test } from "vite-plus/test"

import { clipEncodingActive, clipReencodingActive } from "./clip-encoding"

const settled = {
  status: "ready",
  encodeActive: false,
  encodeProgress: 100,
  encodeStage: null,
  failureReason: null,
} satisfies Pick<
  ClipRow,
  "status" | "encodeActive" | "encodeProgress" | "encodeStage" | "failureReason"
>

test("ready clips remain ready while their media is re-encoded", () => {
  const row = { ...settled, encodeActive: true, encodeProgress: 34 }
  assert.equal(clipEncodingActive(row), true)
  assert.equal(clipReencodingActive(row), true)
})

test("a stopped ready-clip failure is not treated as active work", () => {
  const row = {
    ...settled,
    encodeProgress: 34,
    failureReason: "encoder failed",
  }
  assert.equal(clipEncodingActive(row), false)
})

test("older contract-1 responses fall back to stage and progress", () => {
  const { encodeActive: _encodeActive, ...legacy } = settled
  assert.equal(clipEncodingActive({ ...legacy, encodeStage: "encoding" }), true)
  assert.equal(clipEncodingActive({ ...legacy, encodeProgress: 75 }), true)
  assert.equal(clipEncodingActive(legacy), false)
})
