import { strictEqual } from "node:assert"
import { test } from "node:test"

import { electronAccelerator } from "./recording-hotkey-accelerator"

test("electronAccelerator accepts the default save hotkey", () => {
  strictEqual(electronAccelerator("F8"), "F8")
})

test("electronAccelerator normalizes modifiers", () => {
  strictEqual(electronAccelerator("ctrl + alt + s"), "CommandOrControl+Alt+S")
  strictEqual(electronAccelerator("option + space"), "Alt+Space")
})

test("electronAccelerator discards duplicate modifiers", () => {
  strictEqual(
    electronAccelerator("ctrl + control + shift + F8"),
    "CommandOrControl+Shift+F8",
  )
})

test("electronAccelerator rejects invalid accelerators", () => {
  strictEqual(electronAccelerator(""), null)
  strictEqual(electronAccelerator("ctrl"), null)
  strictEqual(electronAccelerator("ctrl + nope + F8"), null)
  strictEqual(electronAccelerator("F25"), null)
})
