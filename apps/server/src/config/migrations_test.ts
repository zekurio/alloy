import { RUNTIME_CONFIG_VERSION } from "@workspace/contracts"

import { migrateRuntimeConfig } from "./migrations"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test("migrateRuntimeConfig converts legacy oauthProvider to oauthProviders", () => {
  const result = migrateRuntimeConfig({
    oauthProvider: {
      providerId: "zitadel",
      displayName: "Zitadel",
      clientId: "client",
      clientSecret: "secret",
      discoveryUrl: "https://id.example.com/.well-known/openid-configuration",
    },
  })

  assert(result.ok, "migration should succeed")
  assert(result.migrated, "legacy config should be marked migrated")
  assert(
    result.config &&
      typeof result.config === "object" &&
      !Array.isArray(result.config),
    "migrated config should be an object",
  )

  const config = result.config as Record<string, unknown>
  assert(
    config.runtimeConfigVersion === RUNTIME_CONFIG_VERSION,
    "migration should stamp the current runtime config version",
  )
  assert(!("oauthProvider" in config), "legacy oauthProvider should be removed")
  assert(
    Array.isArray(config.oauthProviders) && config.oauthProviders.length === 1,
    "legacy oauthProvider should become a single provider array",
  )
})

Deno.test("migrateRuntimeConfig normalizes legacy encoder variants", () => {
  const result = migrateRuntimeConfig({
    encoder: {
      variants: [
        {
          name: "1080p Source",
          height: 1080,
          quality: 23,
          audioBitrateKbps: 128,
        },
        {
          id: "1080p Source",
          name: "Duplicate",
          height: 720,
          quality: 28,
          audioBitrateKbps: 128,
        },
      ],
    },
  })

  assert(result.ok, "migration should succeed")
  const config = result.config as Record<string, unknown>
  const encoder = config.encoder as Record<string, unknown>
  const variants = encoder.variants as Record<string, unknown>[]

  assert(
    variants[0]?.id === "1080p-source",
    "missing variant id should be generated from the variant name",
  )
  assert(
    variants[1]?.id === "1080p-source-2",
    "duplicate normalized variant id should receive a numeric suffix",
  )
  assert(
    variants[0]?.extraInputArgs === "" &&
      variants[0]?.extraOutputArgs === "",
    "legacy variants should receive explicit ffmpeg argument fields",
  )
  assert(
    encoder.defaultVariantId === "1080p-source",
    "missing default variant id should point at the first variant",
  )
})

Deno.test("migrateRuntimeConfig leaves current configs unchanged", () => {
  const config = {
    runtimeConfigVersion: RUNTIME_CONFIG_VERSION,
    oauthProviders: [],
  }
  const result = migrateRuntimeConfig(config)

  assert(result.ok, "migration should succeed")
  assert(!result.migrated, "current config should not be marked migrated")
  assert(result.config !== config, "migration should not return caller object")
})

Deno.test("migrateRuntimeConfig rejects newer config versions", () => {
  const result = migrateRuntimeConfig({
    runtimeConfigVersion: RUNTIME_CONFIG_VERSION + 1,
  })

  assert(!result.ok, "future config version should be rejected")
})
