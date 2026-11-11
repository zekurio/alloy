import type { PublicAuthConfig } from "@alloy/contracts"
import { configStore } from "@alloy/server/config/store"

import { publicOidcConfig } from "./oauth-config"
import { setupRequired } from "./setup"

/**
 * The single source of truth for the public (unauthenticated) auth config.
 * Served both as the `/api/auth-config` JSON and inlined into the app shell, so
 * the two delivery channels can never drift.
 */
export function buildPublicAuthConfig(): PublicAuthConfig {
  const appearance = configStore.get("appearance")
  const loginSplash = appearance.loginSplash

  return {
    setupRequired: setupRequired(),
    openRegistrations: configStore.get("openRegistrations"),
    passkeyEnabled: configStore.get("passkeyEnabled"),
    requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
    oidc: publicOidcConfig(),
    loginSplash: {
      enabled: loginSplash.enabled,
      blurPx: loginSplash.blurPx,
      darkenOpacity: loginSplash.darkenOpacity,
    },
    accentColors: appearance.accentColors,
  }
}
