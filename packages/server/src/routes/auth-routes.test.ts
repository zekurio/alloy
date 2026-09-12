import assert from "node:assert/strict"

import { Hono } from "hono"
import { test } from "vite-plus/test"

test("passkey routes retain request validation, session gates, CSRF and sign-up throttling", async () => {
  process.env.NODE_ENV = "production"
  process.env.DATABASE_URL = "postgres://localhost/alloy-test"
  process.env.PUBLIC_SERVER_URL = "https://alloy.example"
  process.env.TRUSTED_ORIGINS = "https://alloy.example"
  process.env.ALLOY_VIEWER_COOKIE_SECRET = "v".repeat(32)
  process.env.ALLOY_UPLOAD_HMAC_SECRET = "u".repeat(32)
  const { authRoute } = await import("./auth")
  const app = new Hono().route("/api/auth", authRoute)
  const post = (path: string, origin = "https://alloy.example") =>
    app.request(`/api/auth${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Forwarded-For": "192.0.2.17",
      },
      body: "{}",
    })

  assert.equal(
    (await post("/passkey/sign-up/options", "https://untrusted.example"))
      .status,
    403,
  )
  assert.equal((await app.request("/api/auth/passkeys")).status, 401)
  assert.equal((await post("/passkeys/options")).status, 401)
  assert.equal((await post("/passkeys/verify")).status, 401)
  assert.equal((await post("/passkey/sign-up/verify")).status, 400)
  assert.equal((await post("/passkey/sign-in/verify")).status, 400)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await post("/passkey/sign-up/options")).status, 400)
  }
  const limited = await post("/passkey/sign-up/options")
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get("Retry-After")) > 0)
})
