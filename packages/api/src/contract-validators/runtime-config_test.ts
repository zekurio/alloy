import { test } from "node:test"

import { validateAdminRuntimeConfig } from "./runtime-config"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

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

test("validateAdminRuntimeConfig accepts the default config shape", () => {
  const parsed = validateAdminRuntimeConfig(adminRuntimeConfig())

  assert(parsed.storage.driver === "fs", "storage driver should parse")
  assert(parsed.limits.uploadTtlSec === 900, "limits should parse")
})
