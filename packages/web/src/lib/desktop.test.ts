import assert from "node:assert/strict"

import { DESKTOP_BRIDGE_CONTRACT_1 } from "@alloy/contracts"
import { afterEach, test } from "vite-plus/test"

import { alloyDesktop } from "./desktop"

// SAFETY: Tests install and remove only this synthetic global property.
const host = globalThis as { alloyDesktop?: unknown }

afterEach(() => {
  Reflect.deleteProperty(host, "alloyDesktop")
})

test("accepts only the exact native bridge contract", () => {
  const bridge = { bridgeContract: DESKTOP_BRIDGE_CONTRACT_1 }
  host.alloyDesktop = bridge
  assert.equal(alloyDesktop(), bridge)

  host.alloyDesktop = { bridgeContract: 2 }
  assert.equal(alloyDesktop(), null)

  host.alloyDesktop = { recording: {} }
  assert.equal(alloyDesktop(), null)
})
