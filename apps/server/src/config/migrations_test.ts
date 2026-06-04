import { RUNTIME_CONFIG_VERSION } from "@workspace/contracts"

import { migrateRuntimeConfig } from "./migrations"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

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

Deno.test("migrateRuntimeConfig stamps the current version on pre-baseline configs", () => {
  const result = migrateRuntimeConfig({ runtimeConfigVersion: 0 })

  assert(result.ok, "migration should succeed")
  assert(result.migrated, "older config should be marked migrated")

  const config = result.config as Record<string, unknown>
  assert(
    config.runtimeConfigVersion === RUNTIME_CONFIG_VERSION,
    "migration should stamp the current runtime config version",
  )
})

Deno.test("migrateRuntimeConfig stamps the current version on unversioned baseline configs", () => {
  const result = migrateRuntimeConfig({ oauthProviders: [] })

  assert(result.ok, "migration should succeed")
  assert(result.migrated, "unversioned config should be marked migrated")
  const config = result.config as Record<string, unknown>
  assert(
    config.runtimeConfigVersion === RUNTIME_CONFIG_VERSION,
    "migration should stamp the current runtime config version",
  )
})

Deno.test("migrateRuntimeConfig rejects newer config versions", () => {
  const result = migrateRuntimeConfig({
    runtimeConfigVersion: RUNTIME_CONFIG_VERSION + 1,
  })

  assert(!result.ok, "future config version should be rejected")
})

Deno.test("migrateRuntimeConfig rejects invalid version values", () => {
  const result = migrateRuntimeConfig({ runtimeConfigVersion: "nope" })

  assert(!result.ok, "non-integer version should be rejected")
})

Deno.test("migrateRuntimeConfig rejects non-object input", () => {
  const result = migrateRuntimeConfig([])

  assert(!result.ok, "array input should be rejected")
})
