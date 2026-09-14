import assert from "node:assert/strict"

import { TAURI_DESKTOP_BRIDGE_CONTRACT_1 } from "@alloy/contracts/desktop-tauri"
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

  host.alloyTauriDesktop = { titlebarOverlay: true }
  assert.equal(alloyDesktop(), null)
  assert.equal(isNativeDesktop(), false)

  host.alloyTauriDesktop = { bridgeContract: 2 }
  assert.equal(alloyDesktop(), null)
  assert.equal(isNativeDesktop(), false)
})

test("accepts only the exact desktop bridge contract", () => {
  const bridge = {
    bridgeContract: TAURI_DESKTOP_BRIDGE_CONTRACT_1,
    titlebarOverlay: false,
  }
  host.alloyTauriDesktop = bridge
  assert.equal(alloyDesktop(), bridge)
  assert.equal(isNativeDesktop(), true)
  assert.equal(alloyWindowChrome(), null)
})

test("uses native overlay controls only when requested", () => {
  const tauri = {
    bridgeContract: TAURI_DESKTOP_BRIDGE_CONTRACT_1,
    titlebarOverlay: true,
    minimizeWindow: async () => {},
    toggleMaximizeWindow: async () => {},
    closeWindow: async () => {},
  }
  host.alloyTauriDesktop = tauri
  assert.equal(alloyWindowChrome(), tauri)
})
