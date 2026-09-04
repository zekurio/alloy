import assert from "node:assert/strict"

import { Hono } from "hono"
import { test } from "vite-plus/test"

import {
  setAccountReactivationCookie,
  setOAuthStateCookie,
  setSessionCookies,
} from "./cookies"

test("production authentication cookies are Secure", async () => {
  process.env.NODE_ENV = "production"
  process.env.DATABASE_URL = "postgres://localhost/alloy-test"
  process.env.PUBLIC_SERVER_URL = "https://alloy.example"
  process.env.ALLOY_VIEWER_COOKIE_SECRET = "v".repeat(32)
  process.env.ALLOY_UPLOAD_HMAC_SECRET = "u".repeat(32)

  const app = new Hono().get("/", (c) => {
    setSessionCookies(c, {
      accessToken: "access-token",
      refreshToken: "refresh-token",
    })
    setOAuthStateCookie(c, "provider", "state-token")
    setAccountReactivationCookie(c, "reactivation-token")
    return c.body(null)
  })
  const response = await app.request("https://alloy.example/")
  const cookies = response.headers.getSetCookie()

  assert.equal(cookies.length, 5)
  assert.ok(cookies.some((cookie) => cookie.startsWith("alloy_access=")))
  assert.ok(cookies.some((cookie) => cookie.startsWith("alloy_refresh=")))
  assert.ok(
    cookies.some((cookie) => cookie.startsWith("alloy_oauth_state_provider=")),
  )
  assert.ok(
    cookies.some((cookie) => cookie.startsWith("alloy_account_reactivation=")),
  )
  for (const cookie of cookies) assert.match(cookie, /; Secure(?:;|$)/)
})
