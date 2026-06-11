import assert from "node:assert/strict"
import { test } from "node:test"

import { AdminRuntimeConfigSchema, RuntimeConfigSchema } from "./admin"

function adminRuntimeConfig() {
  return {
    runtimeConfigVersion: 1,
    openRegistrations: false,
    setupComplete: true,
    passkeyEnabled: true,
    requireAuthToBrowse: true,
    oauthProviders: [],
    limits: {
      defaultStorageQuotaBytes: null,
      uploadTtlSec: 900,
    },
    storage: {
      driver: "fs",
      path: "storage",
      clipsPath: null,
      usersPath: null,
      s3: {
        bucket: "",
        region: "us-east-1",
        endpoint: null,
        forcePathStyle: false,
      },
      s3AccessKeyIdSet: false,
      s3SecretAccessKeySet: false,
    },
    appearance: {
      loginSplash: {
        enabled: false,
        blurPx: 24,
        darkenOpacity: 0.8,
      },
    },
    integrations: {
      steamgriddbApiKeySet: false,
    },
    authBaseURL: "https://alloy.test",
  }
}

test("AdminRuntimeConfigSchema accepts the default admin config shape", () => {
  const parsed = AdminRuntimeConfigSchema.parse(adminRuntimeConfig())

  assert.equal(parsed.storage.driver, "fs")
  assert.equal(parsed.limits.uploadTtlSec, 900)
})

test("AdminRuntimeConfigSchema accepts unknown additive fields", () => {
  const parsed = AdminRuntimeConfigSchema.parse({
    ...adminRuntimeConfig(),
    futureServerField: true,
    storage: {
      ...adminRuntimeConfig().storage,
      futureStorageField: "ok",
    },
  })

  assert.equal(parsed.storage.driver, "fs")
})

test("AdminRuntimeConfigSchema rejects missing required fields", () => {
  const config = adminRuntimeConfig()
  Reflect.deleteProperty(config, "storage")

  assert.throws(() => AdminRuntimeConfigSchema.parse(config))
})

test("AdminRuntimeConfigSchema rejects missing provider claim fields", () => {
  assert.throws(() =>
    AdminRuntimeConfigSchema.parse({
      ...adminRuntimeConfig(),
      oauthProviders: [
        {
          providerId: "oidc",
          displayName: "OIDC",
          clientId: "client",
          enabled: true,
          clientSecretSet: false,
        },
      ],
    }),
  )
})

test("RuntimeConfigSchema accepts exported runtime config without admin fields", () => {
  const config = adminRuntimeConfig() as Record<string, unknown>
  Reflect.deleteProperty(config, "authBaseURL")
  Reflect.deleteProperty(config, "integrations")
  const storage = config.storage as Record<string, unknown>
  Reflect.deleteProperty(storage, "s3AccessKeyIdSet")
  Reflect.deleteProperty(storage, "s3SecretAccessKeySet")
  const parsed = RuntimeConfigSchema.parse(config)

  assert.equal(parsed.storage.driver, "fs")
})
