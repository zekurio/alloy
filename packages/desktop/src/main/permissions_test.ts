import { test } from "node:test"

import { isAllowedMainSessionPermission } from "./permissions"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("main session allows the Fullscreen API for clip playback", () => {
  assert(
    isAllowedMainSessionPermission("fullscreen"),
    "fullscreen should be allowed",
  )
})

test("main session keeps sensitive browser permissions denied", () => {
  for (const permission of [
    "media",
    "geolocation",
    "notifications",
    "midiSysex",
    "pointerLock",
    "openExternal",
  ]) {
    assert(
      !isAllowedMainSessionPermission(permission),
      `${permission} should be denied`,
    )
  }
})
