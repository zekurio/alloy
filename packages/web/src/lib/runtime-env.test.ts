import assert from "node:assert/strict"

import { afterEach, test } from "vite-plus/test"

import { apiOrigin, publicOrigin } from "./env"
import {
  createDesktopRuntimeConfig,
  getRuntimeConfig,
  isDesktopRuntime,
  resetRuntimeConfig,
  setRuntimeConfig,
} from "./runtime-env"

afterEach(resetRuntimeConfig)

test("uses the app protocol for desktop API requests", () => {
  const config = createDesktopRuntimeConfig("https://clips.example.test/api")

  assert.equal(config.apiOrigin, "alloy-app://app")
  assert.equal(config.publicOrigin, "https://clips.example.test")
  assert.equal(config.serverUrl, "https://clips.example.test")
})

test("installs and clears the selected desktop server", () => {
  assert.equal(getRuntimeConfig(), null)
  assert.equal(isDesktopRuntime(), false)

  const config = createDesktopRuntimeConfig("https://clips.example.test")
  setRuntimeConfig(config)

  assert.deepEqual(getRuntimeConfig(), config)
  assert.equal(isDesktopRuntime(), true)
  assert.equal(apiOrigin(), "alloy-app://app")
  assert.equal(publicOrigin(), "https://clips.example.test")

  resetRuntimeConfig()
  assert.equal(getRuntimeConfig(), null)
  assert.equal(isDesktopRuntime(), false)
})
