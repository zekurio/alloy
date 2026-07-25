import assert from "node:assert/strict"
import { test } from "node:test"

import {
  CLIP_SCRUBBER_MAX_BYTES,
  CLIP_SCRUBBER_SHEET_HEIGHT,
} from "@alloy/contracts"
import sharp from "sharp"

import { normalizeUploadedScrubber } from "./scrubber-upload"

function spriteJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 120, b: 220 },
    },
  })
    .jpeg()
    .toBuffer()
}

test("normalizeUploadedScrubber accepts and normalizes the desktop sprite", async () => {
  const normalized = await normalizeUploadedScrubber(
    await spriteJpeg(684, CLIP_SCRUBBER_SHEET_HEIGHT),
  )
  const metadata = await sharp(normalized).metadata()
  assert.equal(metadata.format, "jpeg")
  assert.equal(metadata.width, 684)
  assert.equal(metadata.height, CLIP_SCRUBBER_SHEET_HEIGHT)
})

test("normalizeUploadedScrubber rejects the wrong sprite layout", async () => {
  await assert.rejects(
    normalizeUploadedScrubber(
      await spriteJpeg(684, CLIP_SCRUBBER_SHEET_HEIGHT - 1),
    ),
    /invalid sprite layout/,
  )
})

test("normalizeUploadedScrubber rejects a degenerate cell width", async () => {
  await assert.rejects(
    normalizeUploadedScrubber(await spriteJpeg(4, CLIP_SCRUBBER_SHEET_HEIGHT)),
    /invalid sprite layout/,
  )
})

test("normalizeUploadedScrubber rejects oversized input before decoding", async () => {
  await assert.rejects(
    normalizeUploadedScrubber(new Uint8Array(CLIP_SCRUBBER_MAX_BYTES + 1)),
    /allowed size/,
  )
})
