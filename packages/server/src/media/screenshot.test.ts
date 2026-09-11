import { SCREENSHOT_MAX_BYTES } from "@alloy/contracts"
import sharp from "sharp"
import { describe, expect, it } from "vite-plus/test"

import { InitiateBody } from "../routes/clips-helpers"
import { prepareScreenshot } from "./screenshot"

describe("screenshot publishing", () => {
  it("normalizes orientation and removes metadata, rejects mismatched and corrupt bytes", async () => {
    const input = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "red" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const result = await prepareScreenshot(input, "image/jpeg")
    expect([result.width, result.height]).toEqual([20, 40])
    const metadata = await sharp(result.bytes).metadata()
    expect(metadata.orientation).toBeUndefined()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.format).toBe("png")
    expect(result.blurHash.length).toBeGreaterThan(0)
    await expect(prepareScreenshot(input, "image/png")).rejects.toThrow(
      "content type",
    )
    await expect(
      prepareScreenshot(Buffer.from("broken"), "image/png"),
    ).rejects.toThrow("unsupported image format")
  })
})

it("accepts image uploads without video metadata and rejects oversized or video-only fields", () => {
  const input = {
    title: "Screenshot",
    filename: "screenshot.png",
    contentType: "image/png",
    sizeBytes: 100,
    privacy: "public",
  }
  expect(InitiateBody.safeParse(input).success).toBe(true)
  expect(InitiateBody.safeParse({ ...input, durationMs: 1000 }).success).toBe(
    false,
  )
  expect(
    InitiateBody.safeParse({ ...input, trimStartMs: 0, trimEndMs: 1000 })
      .success,
  ).toBe(false)
  expect(
    InitiateBody.safeParse({ ...input, sizeBytes: SCREENSHOT_MAX_BYTES + 1 })
      .success,
  ).toBe(false)
})
