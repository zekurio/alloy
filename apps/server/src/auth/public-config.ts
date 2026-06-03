import {
  loginSplashImagePath,
  type PublicAuthConfig,
} from "@workspace/contracts"

import { env } from "../env"
import { configStore } from "../config/store"
import { getPublicProviders } from "./oauth-config"
import { getSetupStatus } from "./user-bootstrap"

/**
 * The single source of truth for the public (unauthenticated) auth config.
 * Served both as the `/api/auth-config` JSON and inlined into the app shell, so
 * the two delivery channels can never drift.
 */
export async function buildPublicAuthConfig(): Promise<PublicAuthConfig> {
  const setupStatus = await getSetupStatus()
  const loginSplash = configStore.get("appearance").loginSplash

  return {
    ...setupStatus,
    openRegistrations: configStore.get("openRegistrations"),
    passkeyEnabled: configStore.get("passkeyEnabled"),
    requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
    providers: getPublicProviders(),
    loginSplash: {
      enabled: loginSplash.enabled,
      blurPx: loginSplash.blurPx,
      darkenOpacity: loginSplash.darkenOpacity,
      // No storage I/O on this hot path: trust the `enabled` flag and emit the
      // image URL. The splash-serving endpoint 404s if the file is missing, and
      // `ensureLoginSplashImage()` heals it at boot.
      imageUrl: loginSplash.enabled
        ? new URL(loginSplashImagePath(), env.PUBLIC_SERVER_URL).toString()
        : null,
    },
  }
}
