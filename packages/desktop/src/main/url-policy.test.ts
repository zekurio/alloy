import assert from "node:assert/strict"
import test from "node:test"

import { isSelectedServerExternalUrl, isSecureServerUrl } from "./url-policy"

test("opens only exact selected-server URLs outside Electron", () => {
  assert.equal(
    isSelectedServerExternalUrl(
      "https://alloy.example/settings",
      "https://alloy.example",
    ),
    true,
  )
  assert.equal(
    isSelectedServerExternalUrl(
      "https://attacker.example/?leak=value",
      "https://alloy.example",
    ),
    false,
  )
  assert.equal(
    isSelectedServerExternalUrl(
      "http://alloy.example",
      "https://alloy.example",
    ),
    false,
  )
})

test("permits HTTP servers only on loopback", () => {
  assert.equal(isSecureServerUrl(new URL("http://api.localhost:2552")), true)
  assert.equal(isSecureServerUrl(new URL("http://127.4.3.2:2552")), true)
  assert.equal(isSecureServerUrl(new URL("http://192.168.1.10:2552")), false)
  assert.equal(isSecureServerUrl(new URL("https://alloy.example")), true)
})
