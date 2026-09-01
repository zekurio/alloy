import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import {
  isSafeExternalUrl,
  isSecureServerUrl,
  normalizeServerOrigin,
  selectedServerPathUrl,
} from "./url-policy"

test("opens only credential-free web URLs outside Electron", () => {
  assert.equal(isSafeExternalUrl("https://alloy.example/settings"), true)
  assert.equal(isSafeExternalUrl("http://docs.example/guide"), true)
  assert.equal(isSafeExternalUrl("file:///C:/secrets.txt"), false)
  assert.equal(isSafeExternalUrl("https://user:secret@example.com"), false)
})

test("permits HTTP servers only on loopback", () => {
  assert.equal(isSecureServerUrl(new URL("http://api.localhost:2552")), true)
  assert.equal(isSecureServerUrl(new URL("http://127.4.3.2:2552")), true)
  assert.equal(isSecureServerUrl(new URL("http://192.168.1.10:2552")), false)
  assert.equal(isSecureServerUrl(new URL("https://alloy.example")), true)
})

test("normalizes only trusted desktop server origins", () => {
  assert.equal(
    normalizeServerOrigin("https://alloy.example/path?query=1"),
    "https://alloy.example",
  )
  assert.equal(
    normalizeServerOrigin("http://api.localhost:2552/path"),
    "http://api.localhost:2552",
  )
  assert.equal(normalizeServerOrigin("http://192.168.1.10:2552"), null)
  assert.equal(normalizeServerOrigin("https://user@example.com"), null)
})

test("builds navigation only within the selected server origin", () => {
  assert.equal(
    selectedServerPathUrl("https://alloy.example", "/library?sort=new"),
    "https://alloy.example/library?sort=new",
  )
  assert.equal(
    selectedServerPathUrl("https://alloy.example", "//attacker.example"),
    null,
  )
  assert.equal(
    selectedServerPathUrl("https://alloy.example", "/\\attacker.example"),
    null,
  )
})
