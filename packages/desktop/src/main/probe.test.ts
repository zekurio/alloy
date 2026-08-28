import assert from "node:assert/strict"
import test from "node:test"

import { supportsDesktopAuthVersion } from "./probe"

test("uses exact desktop-auth capability membership", () => {
  assert.equal(supportsDesktopAuthVersion(1), true)
  assert.equal(supportsDesktopAuthVersion(0), false)
  assert.equal(supportsDesktopAuthVersion(2), false)
  assert.equal(supportsDesktopAuthVersion(Number.POSITIVE_INFINITY), false)
})
