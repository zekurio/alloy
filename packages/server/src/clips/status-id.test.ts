import assert from "node:assert/strict"
import { test } from "node:test"

import { decodeClipStatusId, encodeClipStatusId } from "./status-id"

test("encodeClipStatusId produces a digits-only id", () => {
  const encoded = encodeClipStatusId("0b7d3f2a-1c44-4e8b-9f10-2ab5c6d7e8f9")
  assert.equal(encoded, "15271826189086941860723332107912866041")
  assert.match(encoded ?? "", /^\d+$/)
})

test("encodeClipStatusId round-trips through decode", () => {
  const clipId = "0b7d3f2a-1c44-4e8b-9f10-2ab5c6d7e8f9"
  assert.equal(decodeClipStatusId(encodeClipStatusId(clipId) ?? ""), clipId)
})

test("round-trip restores leading zeros lost in decimal", () => {
  // A uuid starting with zeros encodes to a shorter decimal; decoding must
  // pad back to 32 hex digits or the uuid comes out malformed.
  const clipId = "00000001-0000-4000-8000-000000000001"
  const encoded = encodeClipStatusId(clipId)
  assert.match(encoded ?? "", /^\d+$/)
  assert.equal(decodeClipStatusId(encoded ?? ""), clipId)
})

test("round-trip handles the maximum uuid", () => {
  const clipId = "ffffffff-ffff-ffff-ffff-ffffffffffff"
  const encoded = encodeClipStatusId(clipId)
  assert.equal(encoded, (2n ** 128n - 1n).toString(10))
  assert.equal(decodeClipStatusId(encoded ?? ""), clipId)
})

test("encodeClipStatusId lowercases via round-trip of an uppercase uuid", () => {
  assert.equal(
    decodeClipStatusId(
      encodeClipStatusId("0B7D3F2A-1C44-4E8B-9F10-2AB5C6D7E8F9") ?? "",
    ),
    "0b7d3f2a-1c44-4e8b-9f10-2ab5c6d7e8f9",
  )
})

test("encodeClipStatusId rejects non-uuid input", () => {
  assert.equal(encodeClipStatusId("not-a-uuid"), null)
  assert.equal(encodeClipStatusId(""), null)
  assert.equal(encodeClipStatusId("0b7d3f2a1c444e8b9f102ab5c6d7e8f9"), null)
})

test("decodeClipStatusId rejects non-numeric ids", () => {
  assert.equal(decodeClipStatusId("0b7d3f2a-1c44-4e8b-9f10-2ab5c6d7e8f9"), null)
  assert.equal(decodeClipStatusId(""), null)
  assert.equal(decodeClipStatusId("12a34"), null)
  assert.equal(decodeClipStatusId("-1"), null)
})

test("decodeClipStatusId rejects values wider than 128 bits", () => {
  assert.equal(decodeClipStatusId((2n ** 128n).toString(10)), null)
})
