import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

import type { OAuthProviderConfig } from "@alloy/contracts"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "auth config store env-locked postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  process.env.ALLOY_OPEN_REGISTRATIONS = "true"
  process.env.ALLOY_PASSKEY_ENABLED = ""
  process.env.ALLOY_REQUIRE_AUTH_TO_BROWSE = ""
  process.env.ALLOY_SOCIALACCOUNT_PROVIDERS = JSON.stringify({
    openid_connect: {
      APPS: [
        {
          provider_id: "env-idp",
          name: "Env Identity",
          client_id: "env-client",
          secret: "env-secret",
          settings: {
            discovery_url:
              "https://env-idp.example.test/.well-known/openid-configuration",
          },
        },
      ],
    },
  })

  const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
  await prepareTestDatabase("auth-config-store-locked")

  // Dynamic imports are required because env and DB modules read process.env at
  // module load time, after prepareTestDatabase installs the isolated test URL.
  const { instanceSetting } = await import("@alloy/db/schema")
  const { client, db } = await import("@alloy/server/db/index")
  const {
    authEnvLocks,
    configStore,
    initializeConfigStore,
    setAuthToggles,
    setOAuthProviders,
    storedOAuthClientSecret,
  } = await import("./store")

  after(() => client.end())

  beforeEach(async () => {
    await db.delete(instanceSetting)
    await initializeConfigStore()
  })

  function providerSummary(providers: readonly OAuthProviderConfig[]) {
    return providers.map(
      ({ providerId, displayName, clientId, discoveryUrl, enabled }) => ({
        providerId,
        displayName,
        clientId,
        discoveryUrl,
        enabled,
      }),
    )
  }

  async function writeAuthSetting(value: {
    openRegistrations: boolean
    passkeyEnabled: boolean
    requireAuthToBrowse: boolean
  }) {
    await db.insert(instanceSetting).values({
      key: "auth",
      value,
      updated_at: new Date(),
    })
  }

  test("auth env locks report only explicitly managed auth settings", () => {
    assert.deepEqual(authEnvLocks(), {
      openRegistrations: true,
      passkeyEnabled: false,
      requireAuthToBrowse: false,
      oauthProviders: true,
    })
  })

  test("environment-managed auth toggle wins over the settings table", async () => {
    await writeAuthSetting({
      openRegistrations: false,
      passkeyEnabled: true,
      requireAuthToBrowse: true,
    })

    await initializeConfigStore()

    assert.equal(configStore.get("openRegistrations"), true)
  })

  test("locked auth toggle writes reject while unlocked toggle writes persist", async () => {
    await assert.rejects(
      () => setAuthToggles({ openRegistrations: false }),
      /ALLOY_OPEN_REGISTRATIONS/,
    )

    await setAuthToggles({ passkeyEnabled: false })

    assert.equal(configStore.get("passkeyEnabled"), false)
  })

  test("environment-managed OAuth providers reject writes and serve env secrets", async () => {
    await assert.rejects(
      () => setOAuthProviders([], {}),
      /ALLOY_SOCIALACCOUNT_PROVIDERS/,
    )

    assert.deepEqual(providerSummary(configStore.get("oauthProviders")), [
      {
        providerId: "env-idp",
        displayName: "Env Identity",
        clientId: "env-client",
        discoveryUrl:
          "https://env-idp.example.test/.well-known/openid-configuration",
        enabled: true,
      },
    ])
    assert.equal(storedOAuthClientSecret("env-idp"), "env-secret")
  })
}
