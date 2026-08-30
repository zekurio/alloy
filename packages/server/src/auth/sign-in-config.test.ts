import assert from "node:assert/strict"
import test from "node:test"

import { usableSignInConfig } from "./sign-in-config"

const PROVIDER_ID = "test-secretless-admin-guard"

test("enabled OAuth providers count only when their client secret is usable", () => {
  const config = {
    passkeyEnabled: false,
    oauthProviders: [{ enabled: true, providerId: PROVIDER_ID }],
  }
  const providerUsable = (
    provider: (typeof config.oauthProviders)[number],
    pendingSecret: (providerId: string) => boolean,
  ) => provider.enabled && pendingSecret(provider.providerId)

  assert.deepEqual(
    usableSignInConfig(config, () => false, providerUsable),
    { passkeyEnabled: false, oauthProviders: [] },
  )
  assert.deepEqual(
    usableSignInConfig(
      config,
      (providerId) => providerId === PROVIDER_ID,
      providerUsable,
    ),
    config,
  )
})
