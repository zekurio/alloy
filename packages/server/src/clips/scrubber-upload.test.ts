import assert from "node:assert/strict"
import { test } from "node:test"

import {
  CLIP_SCRUBBER_COLUMNS,
  CLIP_SCRUBBER_FRAME_COUNT,
  CLIP_SCRUBBER_FRAME_HEIGHT,
  CLIP_SCRUBBER_MAX_BYTES,
} from "@alloy/contracts"
import sharp from "sharp"

import { normalizeUploadedScrubber } from "./scrubber-upload"

const SCRUBBER_HEIGHT =
  Math.ceil(CLIP_SCRUBBER_FRAME_COUNT / CLIP_SCRUBBER_COLUMNS) *
  CLIP_SCRUBBER_FRAME_HEIGHT

test("normalizeUploadedScrubber accepts and normalizes the desktop sprite", async () => {
  const source = await sharp({
    create: {
      width: 684,
      height: SCRUBBER_HEIGHT,
      channels: 3,
      background: { r: 40, g: 120, b: 220 },
    },
  })
    .jpeg()
    .toBuffer()

  const normalized = await normalizeUploadedScrubber(source)
  const metadata = await sharp(normalized).metadata()
  assert.equal(metadata.format, "jpeg")
  assert.equal(metadata.width, 684)
  assert.equal(metadata.height, SCRUBBER_HEIGHT)
})

test("normalizeUploadedScrubber rejects the wrong sprite layout", async () => {
  const source = await sharp({
    create: {
      width: 684,
      height: SCRUBBER_HEIGHT - 1,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer()

  await assert.rejects(
    normalizeUploadedScrubber(source),
    /invalid sprite layout/,
  )
})

test("normalizeUploadedScrubber rejects oversized input before decoding", async () => {
  await assert.rejects(
    normalizeUploadedScrubber(new Uint8Array(CLIP_SCRUBBER_MAX_BYTES + 1)),
    /allowed size/,
  )
})
