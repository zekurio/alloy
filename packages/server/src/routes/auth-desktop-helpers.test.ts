import assert from "node:assert/strict"

import { test } from "vitest"

import {
  DESKTOP_AUTHORIZE_WEB_PATH,
  desktopAuthorizeWebUrl,
  loopbackRedirect,
} from "./auth-desktop-helpers"

test("desktop authorize page URL keeps the loopback handshake parameters", () => {
  const url = desktopAuthorizeWebUrl(
    "http://127.0.0.1:4312/callback",
    "state-value",
    "code-challenge-value",
  )
  assert.ok(url.startsWith(`${DESKTOP_AUTHORIZE_WEB_PATH}?`))
  const params = new URL(url, "https://alloy.example").searchParams
  assert.equal(params.get("redirect_uri"), "http://127.0.0.1:4312/callback")
  assert.equal(params.get("state"), "state-value")
  assert.equal(params.get("code_challenge"), "code-challenge-value")
  // The round-tripped redirect target must still satisfy the loopback check
  // the authorize POST enforces before minting a code.
  assert.ok(loopbackRedirect(params.get("redirect_uri")))
})
