import assert from "node:assert/strict"

import { TAURI_DESKTOP_BRIDGE_CONTRACT_1 } from "@alloy/primitives"
import { afterEach, test } from "vitest"

import { alloyDesktop, alloyWindowChrome, isNativeDesktop } from "./desktop"

// SAFETY: Tests install and remove only this synthetic global property.
const host = globalThis as {
  alloyTauriDesktop?: unknown
}

afterEach(() => {
  Reflect.deleteProperty(host, "alloyTauriDesktop")
})

test("ignores a bridge with a missing or mismatched contract", () => {
  assert.equal(alloyDesktop(), null)
  assert.equal(isNativeDesktop(), false)

  host.alloyTauriDesktop = {}
  assert.equal(alloyDesktop(), null)
  assert.equal(isNativeDesktop(), false)

  host.alloyTauriDesktop = { bridgeContract: 2 }
  assert.equal(alloyDesktop(), null)
  assert.equal(isNativeDesktop(), false)
})

test("accepts only the exact desktop bridge contract", () => {
  const bridge = {
    bridgeContract: TAURI_DESKTOP_BRIDGE_CONTRACT_1,
  }
  host.alloyTauriDesktop = bridge
  assert.equal(alloyDesktop(), bridge)
  assert.equal(isNativeDesktop(), true)
})

test("exposes the window controls of a native bridge", () => {
  const tauri = {
    bridgeContract: TAURI_DESKTOP_BRIDGE_CONTRACT_1,
    minimizeWindow: async () => {},
    toggleMaximizeWindow: async () => {},
    closeWindow: async () => {},
  }
  host.alloyTauriDesktop = tauri
  assert.equal(alloyWindowChrome(), tauri)
})
