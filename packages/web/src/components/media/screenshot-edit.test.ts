import { expect, it } from "vite-plus/test"

import {
  canMoveScreenshotCropAt,
  DEFAULT_SCREENSHOT_EDIT,
  fitScreenshotCrop,
  moveScreenshotCrop,
  resizeScreenshotCrop,
  type CropHandle,
  screenshotDimensions,
} from "./screenshot-edit"

it("fits aspect-ratio crops inside landscape, portrait, and rotated images", () => {
  const source = { x: 0.15, y: 0.2, width: 0.7, height: 0.6 }
  for (const rotation of [0, 90, 37]) {
    const dimensions = screenshotDimensions(2560, 1440, rotation)
    for (const ratio of [
      1,
      16 / 9,
      4 / 3,
      3 / 2,
      21 / 9,
      9 / 16,
      3 / 4,
      2 / 3,
    ]) {
      const crop = fitScreenshotCrop(source, dimensions, ratio)
      expect(
        (crop.width * dimensions.width) / (crop.height * dimensions.height),
      ).toBeCloseTo(ratio)
      expect(crop.x + crop.width / 2).toBeCloseTo(source.x + source.width / 2)
      expect(crop.y + crop.height / 2).toBeCloseTo(source.y + source.height / 2)
      expect(crop.width).toBeLessThanOrEqual(source.width)
      expect(crop.height).toBeLessThanOrEqual(source.height)
    }
  }
  expect(
    fitScreenshotCrop(source, { width: 2560, height: 1440 }, null),
  ).toEqual(source)
  expect(
    fitScreenshotCrop(
      DEFAULT_SCREENSHOT_EDIT.crop,
      { width: 2560, height: 1440 },
      16 / 9,
    ),
  ).toEqual(DEFAULT_SCREENSHOT_EDIT.crop)
})

it("moves crops without changing their size or leaving the image", () => {
  const crop = { x: 0.2, y: 0.25, width: 0.4, height: 0.3 }

  const moved = moveScreenshotCrop(crop, 0.1, -0.15)
  expect(moved).toMatchObject({
    y: 0.1,
    width: 0.4,
    height: 0.3,
  })
  expect(moved.x).toBeCloseTo(0.3)
  expect(moveScreenshotCrop(crop, -1, 1)).toEqual({
    x: 0,
    y: 0.7,
    width: 0.4,
    height: 0.3,
  })
})

it("moves only custom crops when the pointer starts inside them", () => {
  const crop = { x: 0.2, y: 0.25, width: 0.4, height: 0.3 }

  expect(canMoveScreenshotCropAt(crop, 0.3, 0.4)).toBe(true)
  expect(canMoveScreenshotCropAt(crop, 0.1, 0.4)).toBe(false)
  expect(canMoveScreenshotCropAt(DEFAULT_SCREENSHOT_EDIT.crop, 0.5, 0.5)).toBe(
    false,
  )
})

it("resizes every crop handle within the image and keeps fixed aspect ratios", () => {
  const dimensions = { width: 1600, height: 900 }
  const source = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }
  const handles: CropHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]
  for (const handle of handles) {
    for (const ratio of [null, 16 / 9]) {
      for (const delta of [-2, -0.1, 0.1, 2]) {
        const crop = resizeScreenshotCrop(
          source,
          handle,
          delta,
          delta,
          dimensions,
          ratio,
        )
        expect(crop.x).toBeGreaterThanOrEqual(-1e-10)
        expect(crop.y).toBeGreaterThanOrEqual(-1e-10)
        expect(crop.x + crop.width).toBeLessThanOrEqual(1 + 1e-10)
        expect(crop.y + crop.height).toBeLessThanOrEqual(1 + 1e-10)
        expect(crop.width).toBeGreaterThan(0)
        expect(crop.height).toBeGreaterThan(0)
        const anchorX = handle.includes("w")
          ? 1
          : handle.includes("e")
            ? 0
            : 0.5
        const anchorY = handle.includes("n")
          ? 1
          : handle.includes("s")
            ? 0
            : 0.5
        expect(crop.x + crop.width * anchorX).toBeCloseTo(
          source.x + source.width * anchorX,
        )
        expect(crop.y + crop.height * anchorY).toBeCloseTo(
          source.y + source.height * anchorY,
        )
        const locked = resizeScreenshotCrop(
          source,
          handle,
          delta,
          delta,
          dimensions,
          16 / 9,
        )
        expect(
          (locked.width * dimensions.width) /
            (locked.height * dimensions.height),
        ).toBeCloseTo(16 / 9)
      }
    }
  }
  expect(resizeScreenshotCrop(source, "e", 0.1, 0.2, dimensions, null)).toEqual(
    { ...source, width: 0.7 },
  )
  const resized = resizeScreenshotCrop(
    DEFAULT_SCREENSHOT_EDIT.crop,
    "nw",
    0.2,
    0.3,
    dimensions,
    null,
  )
  expect(resized.x).toBeCloseTo(0.2)
  expect(resized.y).toBeCloseTo(0.3)
  expect(resized.width).toBeCloseTo(0.8)
  expect(resized.height).toBeCloseTo(0.7)
})
