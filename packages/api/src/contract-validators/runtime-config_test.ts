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
    encoder: {
      enabled: true,
      hwaccel: "qsv",
      qsvDevice: "/dev/dri/renderD128",
      vaapiDevice: "/dev/dri/renderD128",
      intelLowPowerH264: false,
      intelLowPowerHevc: false,
    },
    limits: {
      maxUploadBytes: 4_294_967_296,
      defaultStorageQuotaBytes: null,
      uploadTtlSec: 900,
    },
    machineLearning: {
      enabled: false,
      baseUrl: "http://localhost:2662",
      requestTimeoutMs: 60_000,
      gameClassifier: {
        modelName: "model",
        modelVersion: null,
        repoId: "repo",
        filename: "checkpoint.onnx",
        revision: "main",
        checkpointPath: null,
      },
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

Deno.test("validateAdminRuntimeConfig accepts Intel low-power encoder booleans", () => {
  const config = adminRuntimeConfig()
  config.encoder.intelLowPowerH264 = true
  config.encoder.intelLowPowerHevc = true

  const parsed = validateAdminRuntimeConfig(config)

  assert(
    parsed.encoder.intelLowPowerH264,
    "H.264 low-power should round-trip",
  )
  assert(
    parsed.encoder.intelLowPowerHevc,
    "HEVC low-power should round-trip",
  )
})

Deno.test("validateAdminRuntimeConfig rejects missing Intel low-power encoder booleans", () => {
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
