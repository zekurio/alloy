import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

import type { OAuthProviderConfig } from "@alloy/contracts"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL
const authEnvKeys = [
  "ALLOY_OPEN_REGISTRATIONS",
  "ALLOY_PASSKEY_ENABLED",
  "ALLOY_REQUIRE_AUTH_TO_BROWSE",
  "ALLOY_SOCIALACCOUNT_PROVIDERS",
]

if (!testDatabaseUrl) {
  test(
    "auth config store postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  for (const key of authEnvKeys) process.env[key] = ""

  const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
  await prepareTestDatabase("auth-config-store")

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

  const provider = (
    providerId: string,
    displayName: string,
  ): OAuthProviderConfig => ({
    providerId,
    displayName,
    clientId: `${providerId}-client`,
    enabled: true,
    discoveryUrl: `https://${providerId}.example.test/.well-known/openid-configuration`,
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

  test("empty settings table resolves auth config defaults", () => {
    assert.equal(configStore.get("openRegistrations"), false)
    assert.equal(configStore.get("passkeyEnabled"), true)
    assert.equal(configStore.get("requireAuthToBrowse"), true)
    assert.deepEqual(configStore.get("oauthProviders"), [])
  })

  test("auth env locks are open when auth environment variables are absent", () => {
    assert.deepEqual(authEnvLocks(), {
      openRegistrations: false,
      passkeyEnabled: false,
      requireAuthToBrowse: false,
      oauthProviders: false,
    })
  })

  test("auth toggles persist and rehydrate from the settings table", async () => {
    await setAuthToggles({ openRegistrations: true })

    assert.equal(configStore.get("openRegistrations"), true)

    await initializeConfigStore()

    assert.equal(configStore.get("openRegistrations"), true)
  })

  test("partial auth toggle patches preserve the other stored toggles", async () => {
    await setAuthToggles({
      openRegistrations: true,
      passkeyEnabled: false,
      requireAuthToBrowse: false,
    })

    await setAuthToggles({ openRegistrations: false })

    assert.equal(configStore.get("openRegistrations"), false)
    assert.equal(configStore.get("passkeyEnabled"), false)
    assert.equal(configStore.get("requireAuthToBrowse"), false)
  })

  test("provider replacement keeps surviving secrets and prunes removed secrets", async () => {
    const p1 = provider("p1", "Provider One")
    const p2 = provider("p2", "Provider Two")

    await setOAuthProviders([p1, p2], { p1: "s1", p2: "s2" })
    await setOAuthProviders([p1], {})

    assert.deepEqual(providerSummary(configStore.get("oauthProviders")), [
      {
        providerId: "p1",
        displayName: "Provider One",
        clientId: "p1-client",
        discoveryUrl:
          "https://p1.example.test/.well-known/openid-configuration",
        enabled: true,
      },
    ])
    assert.equal(storedOAuthClientSecret("p1"), "s1")
    assert.equal(storedOAuthClientSecret("p2"), "")
  })

  test("provider replacement rotates non-empty submitted secrets", async () => {
    const p1 = provider("p1", "Provider One")

    await setOAuthProviders([p1], { p1: "s1" })
    await setOAuthProviders([p1], { p1: "s1-new" })

    assert.equal(storedOAuthClientSecret("p1"), "s1-new")
  })

  test("invalid provider replacement rejects without changing stored providers or secrets", async () => {
    const p1 = provider("p1", "Provider One")
    const p2 = provider("p2", "Provider Two")
    await setOAuthProviders([p1], { p1: "s1" })

    const invalidCases: Array<{
      name: string
      providers: OAuthProviderConfig[]
      error: RegExp
    }> = [
      {
        name: "duplicate provider id",
        providers: [p1, { ...p1, displayName: "Duplicate Provider One" }],
        error: /Provider ID must be unique/,
      },
      {
        name: "missing OAuth endpoints",
        providers: [{ ...p2, discoveryUrl: undefined }],
        error: /Provide discoveryUrl/,
      },
    ]

    for (const { name, providers, error } of invalidCases) {
      await assert.rejects(
        () => setOAuthProviders(providers, { p2: "s2" }),
        error,
        name,
      )
      assert.deepEqual(providerSummary(configStore.get("oauthProviders")), [
        {
          providerId: "p1",
          displayName: "Provider One",
          clientId: "p1-client",
          discoveryUrl:
            "https://p1.example.test/.well-known/openid-configuration",
          enabled: true,
        },
      ])
      assert.equal(storedOAuthClientSecret("p1"), "s1")
      assert.equal(storedOAuthClientSecret("p2"), "")
    }
  })
}
