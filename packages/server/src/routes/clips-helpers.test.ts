import assert from "node:assert/strict"
import test from "node:test"

import { parseRange } from "./clips-range"

const size = 1000

test("parseRange classifies absent and ignored range headers", () => {
  assert.deepEqual(parseRange(undefined, size), { kind: "none" })
  assert.deepEqual(parseRange("garbage", size), { kind: "none" })
  assert.deepEqual(parseRange("items=0-4", size), { kind: "none" })
  assert.deepEqual(parseRange("bytes=0-1,5-9", size), { kind: "none" })
})

test("parseRange parses satisfiable byte ranges", () => {
  assert.deepEqual(parseRange("bytes=0-499", size), {
    kind: "range",
    start: 0,
    end: 499,
  })
  assert.deepEqual(parseRange("bytes=500-", size), {
    kind: "range",
    start: 500,
    end: 999,
  })
  assert.deepEqual(parseRange("bytes=-500", size), {
    kind: "range",
    start: 500,
    end: 999,
  })
  assert.deepEqual(parseRange("bytes=0-999999", size), {
    kind: "range",
    start: 0,
    end: 999,
  })
})

test("parseRange reports unsatisfiable byte ranges", () => {
  assert.deepEqual(parseRange("bytes=-0", size), { kind: "unsatisfiable" })
  assert.deepEqual(parseRange("bytes=1000-", size), {
    kind: "unsatisfiable",
  })
  assert.deepEqual(parseRange("bytes=9999-10000", size), {
    kind: "unsatisfiable",
  })
  assert.deepEqual(parseRange("bytes=5-2", size), { kind: "unsatisfiable" })
})
