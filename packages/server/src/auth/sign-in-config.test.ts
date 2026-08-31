import assert from "node:assert/strict"
import test from "node:test"

import { usableSignInConfig } from "./sign-in-config"

const PROVIDER_ID = "test-secretless-admin-guard"

test("enabled OAuth providers count only when their client secret is usable", () => {
  process.env.DATABASE_URL = "postgres://localhost/alloy-test"
  process.env.ALLOY_VIEWER_COOKIE_SECRET = "v".repeat(32)
  process.env.ALLOY_UPLOAD_HMAC_SECRET = "u".repeat(32)

  const config = {
    passkeyEnabled: false,
    oauthProviders: [{ enabled: true, providerId: PROVIDER_ID }],
  }
  assert.deepEqual(
    usableSignInConfig(config, () => false),
    { passkeyEnabled: false, oauthProviders: [] },
  )
  assert.deepEqual(
    usableSignInConfig(config, (providerId) => providerId === PROVIDER_ID),
    config,
  )
})
