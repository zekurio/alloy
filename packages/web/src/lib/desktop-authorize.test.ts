import assert from "node:assert/strict"

import { test } from "vitest"

import { isDesktopAuthorizeSearch } from "./desktop-authorize"

const CHALLENGE = "a".repeat(43)

test("accepts a complete loopback handshake", () => {
  assert.equal(
    isDesktopAuthorizeSearch({
      redirect_uri: "http://127.0.0.1:4312/callback",
      state: "state-value",
      code_challenge: CHALLENGE,
    }),
    true,
  )
})

test("rejects non-loopback targets and malformed challenges", () => {
  assert.equal(
    isDesktopAuthorizeSearch({
      redirect_uri: "https://alloy.example/callback",
      state: "state-value",
      code_challenge: CHALLENGE,
    }),
    false,
  )
  assert.equal(
    isDesktopAuthorizeSearch({
      redirect_uri: "http://127.0.0.1:4312/callback",
      state: "state-value",
      code_challenge: "too-short",
    }),
    false,
  )
  assert.equal(isDesktopAuthorizeSearch({}), false)
})
