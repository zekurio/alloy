import { test } from "node:test"

import { validatePublicAuthConfig } from "./auth-users-comments"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function publicAuthConfig() {
  return {
    adminAccountRequired: false,
    setupRequired: false,
    openRegistrations: true,
    passkeyEnabled: true,
    requireAuthToBrowse: false,
    desktopAuth: { version: 1 },
    providers: [],
    loginSplash: {
      enabled: false,
      blurPx: 24,
      darkenOpacity: 0.8,
    },
  }
}

test("validatePublicAuthConfig accepts desktop auth capability", () => {
  const parsed = validatePublicAuthConfig(publicAuthConfig())

  assert(
    parsed.desktopAuth.version === 1,
    "desktop auth capability version should round-trip",
  )
})

test("validatePublicAuthConfig rejects missing desktop auth capability", () => {
  const config = publicAuthConfig()
  delete (config as Partial<typeof config>).desktopAuth

  let failed = false
  try {
    validatePublicAuthConfig(config)
  } catch {
    failed = true
  }

  assert(failed, "missing desktop auth capability should fail validation")
})
