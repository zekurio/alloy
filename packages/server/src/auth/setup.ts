import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import type { SetupMode } from "@alloy/contracts"
import { isLoopbackHostname } from "@alloy/env"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"
import type { DbTransaction } from "@alloy/server/db/transaction"
import { env } from "@alloy/server/env"
import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

import { withAdminAccessChange } from "./admin-access"
import { secureCookies } from "./cookies"
import { usableOidcProvider } from "./oauth-config"

const logger = createLogger("setup")

const SETUP_ACCESS_COOKIE = "alloy_setup_access"
// Every request that can create the first admin lives under /api.
const SETUP_ACCESS_COOKIE_PATH = "/api"
const SETUP_ACCESS_TTL_SEC = 60 * 60

export const SETUP_ACCESS_REQUIRED = "Enter the setup token first."
export const SETUP_ADMIN_CLAIM_REQUIRED =
  "Only an account your sign-in provider marks as an admin can finish setup."

/**
 * True until the first admin exists. The server records it in the
 * transaction that creates that admin, so setup can't open again later.
 */
export function setupRequired(): boolean {
  return !configStore.setupComplete()
}

/**
 * How the first admin gets created. With single sign-on configured, only an
 * identity whose role claim says admin can, so the provider decides and no
 * token is needed. Without it, a passkey sign-up behind the setup token.
 * Null when neither is on. Settings can't change before an admin exists, so
 * the mode holds until setup is done.
 */
export function setupMode(): SetupMode | null {
  if (usableOidcProvider()) return "oidc"
  return configStore.get("passkeyEnabled") ? "passkey" : null
}

/**
 * Run `create` as the transaction that makes the first admin and records
 * setup as done.
 */
export function createFirstAdmin<T>(
  create: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return withAdminAccessChange(async () => {
    if (!setupRequired()) throw new Error("Setup is already complete.")
    return configStore.completeSetup(create)
  })
}

// Passkey setup has nothing but the token to tell the person who runs the
// server from whoever reaches it first. Where a client connects from proves
// nothing, since NAT and container port forwarding make internet visitors
// look local. Alloy runs as one process, so a generated token lives in
// memory: a restart before setup finishes logs a new one, unless
// ALLOY_SETUP_TOKEN pins it.
let generatedToken: string | null = null

/**
 * Only a development server on a loopback origin skips the token, so local
 * setup stays one step. NODE_ENV defaults to development, so a deployment
 * that forgets it still gets the token through its public URL, and
 * ALLOY_SETUP_TOKEN turns the token on everywhere.
 */
function setupTokenEnforced(): boolean {
  if (env.setupToken !== null) return true
  return !(
    env.NODE_ENV === "development" &&
    isLoopbackHostname(new URL(env.PUBLIC_SERVER_URL).hostname)
  )
}

function setupToken(): string {
  return env.setupToken ?? (generatedToken ??= randomBytes(24).toString("hex"))
}

function matchesSetupToken(value: string): boolean {
  const digest = (text: string) => createHash("sha256").update(text).digest()
  return timingSafeEqual(digest(value), digest(setupToken()))
}

/** Log at startup how to create the first admin, while there is none. */
export function announceSetup(): void {
  if (!setupRequired()) return
  const setupUrl = new URL("/setup", env.PUBLIC_SERVER_URL).toString()
  const provider = usableOidcProvider()
  if (provider) {
    if (env.setupToken !== null) {
      logger.warn(
        "ALLOY_SETUP_TOKEN is set, but with single sign-on configured the provider decides who becomes the admin. The token is unused.",
      )
    }
    logger.info(
      `Setup is not finished. Open ${setupUrl} and sign in with ${provider.displayName} as an account whose ${provider.roleClaim} claim is admin.`,
    )
    return
  }
  if (!configStore.get("passkeyEnabled")) {
    logger.warn(
      "Setup is not finished, and nothing can create the admin account: passkeys are off and single sign-on is not configured. Set ALLOY_PASSKEY_ENABLED=true or the ALLOY_OIDC_* variables, then restart.",
    )
    return
  }
  if (!setupTokenEnforced()) {
    logger.info(
      `Setup is not finished. Open ${setupUrl} to create the admin account.`,
    )
    return
  }
  logger.warn(
    env.setupToken === null
      ? `Setup is not finished. Open ${setupUrl} and enter this setup token to create the admin account: ${setupToken()}`
      : `Setup is not finished. Open ${setupUrl} and enter the token in ALLOY_SETUP_TOKEN to create the admin account.`,
  )
}

/**
 * Check a presented token and, when it matches, keep it in an HttpOnly
 * cookie so this browser can create the admin with a passkey.
 */
export function verifySetupToken(c: Context, presented: string): boolean {
  if (!matchesSetupToken(presented.trim())) return false
  setCookie(c, SETUP_ACCESS_COOKIE, setupToken(), {
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookies(),
    path: SETUP_ACCESS_COOKIE_PATH,
    maxAge: SETUP_ACCESS_TTL_SEC,
  })
  return true
}

/** Whether this request may create the first admin with a passkey. */
export function hasSetupAccess(c: Context): boolean {
  if (!setupTokenEnforced()) return true
  const cookie = getCookie(c, SETUP_ACCESS_COOKIE)
  return cookie !== undefined && matchesSetupToken(cookie)
}

/** Drop this browser's cookie once the admin exists. */
export function endSetupAccess(c: Context): void {
  deleteCookie(c, SETUP_ACCESS_COOKIE, {
    path: SETUP_ACCESS_COOKIE_PATH,
    secure: secureCookies(),
  })
}
