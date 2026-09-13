import assert from "node:assert/strict"

import { TAURI_DESKTOP_BRIDGE_CONTRACT_1 } from "@alloy/contracts/desktop-tauri"
import { afterEach, test } from "vite-plus/test"

import {
  alloyDesktop,
  alloyTauriDesktop,
  alloyWindowChrome,
  isNativeDesktop,
} from "./desktop"

// SAFETY: Tests install and remove only this synthetic global property.
const host = globalThis as {
  alloyDesktop?: unknown
  alloyTauriDesktop?: unknown
}

afterEach(() => {
  Reflect.deleteProperty(host, "alloyDesktop")
  Reflect.deleteProperty(host, "alloyTauriDesktop")
})

test("ignores retired Electron bridges", () => {
  host.alloyDesktop = { bridgeContract: 1 }
  assert.equal(alloyDesktop(), null)
  assert.equal(isNativeDesktop(), false)
})

test("accepts only the exact Tauri bridge contract", () => {
  const bridge = {
    bridgeContract: TAURI_DESKTOP_BRIDGE_CONTRACT_1,
    titlebarOverlay: false,
  }
  host.alloyTauriDesktop = bridge
  assert.equal(alloyTauriDesktop(), bridge)
  assert.equal(alloyDesktop(), bridge)
  assert.equal(isNativeDesktop(), true)
  assert.equal(alloyWindowChrome(), null)

  host.alloyTauriDesktop = { bridgeContract: 2 }
  assert.equal(alloyTauriDesktop(), null)
  assert.equal(isNativeDesktop(), false)
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
