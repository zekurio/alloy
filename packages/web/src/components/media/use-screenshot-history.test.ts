import { expect, it } from "vite-plus/test"

import { DEFAULT_SCREENSHOT_EDIT } from "./screenshot-edit"
import {
  createScreenshotHistory,
  screenshotHistory,
} from "./use-screenshot-history"

it("undoes gestures as steps, restores ratio selection, and replaces redo after a new edit", () => {
  const original = { edit: DEFAULT_SCREENSHOT_EDIT, aspectRatio: "free" }
  const rotated = {
    edit: { ...original.edit, rotation: 90 },
    aspectRatio: "free",
  }
  let history = createScreenshotHistory(original.edit)
  const act = (action: Parameters<typeof screenshotHistory>[1]) => {
    history = screenshotHistory(history, action)
  }
  act({ type: "change", snapshot: rotated })
  for (const rotation of [91, 100, 120])
    act({
      type: "preview",
      snapshot: { ...rotated, edit: { ...rotated.edit, rotation } },
    })
  act({ type: "commit" })
  const adjusted = history.present
  const square = {
    aspectRatio: "1:1",
    edit: { ...adjusted.edit, crop: { x: 0.2, y: 0, width: 0.6, height: 1 } },
  }
  act({ type: "change", snapshot: square })
  act({ type: "undo" })
  expect(history.present).toEqual(adjusted)
  act({ type: "undo" })
  expect(history.present).toEqual(rotated)
  act({ type: "redo" })
  expect(history.present).toEqual(adjusted)
  act({ type: "redo" })
  expect(history.present).toEqual(square)
  act({ type: "undo" })
  const flipped = { ...adjusted, edit: { ...adjusted.edit, flipX: true } }
  act({ type: "change", snapshot: flipped })
  act({ type: "redo" })
  expect(history.present).toEqual(flipped)
  act({ type: "undo" })
  // A gesture that returns to its starting position must retain redo.
  act({ type: "preview", snapshot: flipped })
  act({ type: "preview", snapshot: adjusted })
  act({ type: "commit" })
  act({ type: "redo" })
  expect(history.present).toEqual(flipped)
  act({ type: "undo" })
  act({ type: "undo" })
  act({ type: "undo" })
  expect(history.present).toEqual(original)
  act({ type: "undo" })
  expect(history.present).toEqual(original)
})
