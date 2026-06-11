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
    scheduledTasks: {},
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

test("validateAdminRuntimeConfig accepts scheduled task triggers", () => {
  const config = adminRuntimeConfig()
  ;(config.scheduledTasks as Record<string, unknown>)["sample-maintenance"] = [
    { type: "startup", delayMs: 60_000 },
    { type: "cron", expression: "0 3 * * *" },
  ]

  const parsed = validateAdminRuntimeConfig(config)
  const triggers = parsed.scheduledTasks["sample-maintenance"]

  assert(triggers?.[0]?.type === "startup", "startup trigger should parse")
  assert(triggers?.[1]?.type === "cron", "cron trigger should parse")
})
