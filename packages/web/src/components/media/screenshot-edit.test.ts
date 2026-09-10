import { expect, it } from "vite-plus/test"

import {
  DEFAULT_SCREENSHOT_EDIT,
  fitScreenshotCrop,
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
