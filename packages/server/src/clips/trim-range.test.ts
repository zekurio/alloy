import assert from "node:assert/strict"
import { test } from "node:test"

import { resolveTrimRange } from "./trim-range"

test("resolveTrimRange clamps negative start to zero", () => {
  assert.deepEqual(
    resolveTrimRange({ startMs: -250, endMs: 4_000, durationMs: 5_000 }),
    { kind: "range", startMs: 0, endMs: 4_000 },
  )
})

test("resolveTrimRange clamps end down to duration", () => {
  assert.deepEqual(
    resolveTrimRange({ startMs: 1_000, endMs: 6_000, durationMs: 5_000 }),
    { kind: "range", startMs: 1_000, endMs: 5_000 },
  )
})

test("resolveTrimRange rejects too-short ranges", () => {
  assert.deepEqual(
    resolveTrimRange({ startMs: 1_000, endMs: 1_999, durationMs: 5_000 }),
    { kind: "invalid", reason: "The trimmed range is too short" },
  )
})

test("resolveTrimRange rejects ranges that become too short after clamping", () => {
  assert.deepEqual(
    resolveTrimRange({ startMs: 4_500, endMs: 6_000, durationMs: 5_000 }),
    { kind: "invalid", reason: "The trimmed range is too short" },
  )
})

test("resolveTrimRange detects exact full-range bounds", () => {
  assert.deepEqual(
    resolveTrimRange({ startMs: 0, endMs: 5_000, durationMs: 5_000 }),
    { kind: "full-range" },
  )
})

test("resolveTrimRange detects full-range at tolerance edges", () => {
  assert.deepEqual(
    resolveTrimRange({ startMs: 50, endMs: 4_950, durationMs: 5_000 }),
    { kind: "full-range" },
  )
})

test("resolveTrimRange treats outside tolerance as a range", () => {
  assert.deepEqual(
    resolveTrimRange({ startMs: 51, endMs: 4_950, durationMs: 5_000 }),
    { kind: "range", startMs: 51, endMs: 4_950 },
  )
})

test("resolveTrimRange passes normal mid-clip ranges through unchanged", () => {
  assert.deepEqual(
    resolveTrimRange({ startMs: 1_250, endMs: 3_750, durationMs: 5_000 }),
    { kind: "range", startMs: 1_250, endMs: 3_750 },
  )
})
