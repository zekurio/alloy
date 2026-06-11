import {
  DESKTOP_AUTH_CAPABILITY_VERSION,
  type PublicAuthConfig,
} from "@alloy/contracts"
import { configStore } from "@alloy/server/config/store"

import { getPublicProviders } from "./oauth-config"
import { getSetupStatus } from "./user-bootstrap"

/**
 * The single source of truth for the public (unauthenticated) auth config.
 * Served both as the `/api/auth-config` JSON and inlined into the app shell, so
 * the two delivery channels can never drift.
 */
export async function buildPublicAuthConfig(): Promise<PublicAuthConfig> {
  // Once setup is complete an admin sign-in method provably exists (the admin
  // routes refuse to remove the last one), so we can skip the DB lookup that
  // getSetupStatus runs — this is on the HTML hot path (every page load). Only
  // during the brief pre-setup window do we hit the database.
  const setupStatus = configStore.get("setupComplete")
    ? { adminAccountRequired: false, setupRequired: false }
    : await getSetupStatus()
  const loginSplash = configStore.get("appearance").loginSplash

  return {
    ...setupStatus,
    openRegistrations: configStore.get("openRegistrations"),
    passkeyEnabled: configStore.get("passkeyEnabled"),
    requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
    desktopAuth: { version: DESKTOP_AUTH_CAPABILITY_VERSION },
    providers: getPublicProviders(),
    loginSplash: {
      enabled: loginSplash.enabled,
      blurPx: loginSplash.blurPx,
      darkenOpacity: loginSplash.darkenOpacity,
    },
  }
}
