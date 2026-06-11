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
    encoder: {
      enabled: true,
      hwaccel: "qsv",
      qsvDevice: "/dev/dri/renderD128",
      vaapiDevice: "/dev/dri/renderD128",
      intelLowPowerH264: false,
      intelLowPowerHevc: false,
      tonemapping: {
        enabled: true,
        algorithm: "bt2390",
        mode: "auto",
        range: "auto",
        desat: 0,
        peak: 100,
        param: null,
        threshold: 0.2,
        vpp: {
          enabled: true,
          brightness: 16,
          contrast: 1,
        },
      },
    },
    limits: {
      maxUploadBytes: 4_294_967_296,
      defaultStorageQuotaBytes: null,
      uploadTtlSec: 900,
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

test("validateAdminRuntimeConfig accepts Intel low-power encoder booleans", () => {
  const config = adminRuntimeConfig()
  config.encoder.intelLowPowerH264 = true
  config.encoder.intelLowPowerHevc = true

  const parsed = validateAdminRuntimeConfig(config)

  assert(parsed.encoder.intelLowPowerH264, "H.264 low-power should round-trip")
  assert(parsed.encoder.intelLowPowerHevc, "HEVC low-power should round-trip")
  assert(
    parsed.encoder.tonemapping.algorithm === "bt2390",
    "tone mapping config should round-trip",
  )
})

test("validateAdminRuntimeConfig rejects missing Intel low-power encoder booleans", () => {
  const config = adminRuntimeConfig()
  delete (config.encoder as Partial<typeof config.encoder>).intelLowPowerH264

  let failed = false
  try {
    validateAdminRuntimeConfig(config)
  } catch {
    failed = true
  }

  assert(failed, "missing H.264 low-power field should fail validation")
})

test("validateAdminRuntimeConfig rejects missing tone mapping config", () => {
  const config = adminRuntimeConfig()
  delete (config.encoder as Partial<typeof config.encoder>).tonemapping

  let failed = false
  try {
    validateAdminRuntimeConfig(config)
  } catch {
    failed = true
  }

  assert(failed, "missing tone mapping config should fail validation")
})

test("validateAdminRuntimeConfig accepts scheduled task jitter", () => {
  const config = adminRuntimeConfig()
  ;(config.scheduledTasks as Record<string, unknown>)["clip-storage-cleanup"] =
    [
      { type: "startup", delayMs: 60_000, jitterMs: 30_000 },
      { type: "cron", expression: "0 3 * * *", jitterMs: 120_000 },
    ]

  const parsed = validateAdminRuntimeConfig(config)
  const triggers = parsed.scheduledTasks["clip-storage-cleanup"]

  assert(triggers?.[0]?.jitterMs === 30_000, "startup jitter should round-trip")
  assert(triggers?.[1]?.jitterMs === 120_000, "cron jitter should round-trip")
})
