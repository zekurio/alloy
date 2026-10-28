import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { isLoopbackHostname } from "@alloy/env"
import { createLogger } from "@alloy/logging"
import { env } from "@alloy/server/env"
import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

import { secureCookies } from "./cookies"

const logger = createLogger("setup")

const SETUP_ACCESS_COOKIE = "alloy_setup_access"
// Every request that can create the first admin lives under /api.
const SETUP_ACCESS_COOKIE_PATH = "/api"
const SETUP_ACCESS_TTL_MS = 60 * 60 * 1000

// The first account becomes the admin, so whoever creates it has to prove
// they run the server: they paste a token that only the server's environment
// or log shows. Where a client connects from proves nothing, since NAT and
// container port forwarding make internet visitors look local. Alloy runs as
// one process, so the token and the browsers that presented it live in
// memory. A restart before setup finishes prints a new token, unless
// ALLOY_SETUP_TOKEN pins one. Once the admin exists the generated token is
// dropped, so setup that reopens later prints a fresh one.
let generatedToken: string | null = null
let announced = false
const verifiedBrowsers = new Map<string, number>()

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
  return env.setupToken ?? (generatedToken ??= randomToken())
}

function randomToken(): string {
  return randomBytes(24).toString("base64url")
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

/**
 * Log the token once while the server needs its first admin: at startup,
 * and again when setup reopens while the server runs.
 */
export function announceSetupToken(): void {
  if (announced || !setupTokenEnforced()) return
  announced = true
  if (env.setupToken) {
    logger.info(
      "Setup is not finished. Enter the token in ALLOY_SETUP_TOKEN to create the admin account.",
    )
    return
  }
  logger.warn(
    `Setup is not finished. Enter this setup token to create the admin account: ${setupToken()}`,
  )
}

/**
 * Check a presented token and, when it matches, remember this browser with
 * an HttpOnly cookie for the rest of setup.
 */
export function verifySetupToken(c: Context, presented: string): boolean {
  if (!timingSafeEqual(digest(presented.trim()), digest(setupToken()))) {
    return false
  }
  const browser = randomToken()
  verifiedBrowsers.set(browser, Date.now() + SETUP_ACCESS_TTL_MS)
  setCookie(c, SETUP_ACCESS_COOKIE, browser, {
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookies(),
    path: SETUP_ACCESS_COOKIE_PATH,
    maxAge: SETUP_ACCESS_TTL_MS / 1000,
  })
  return true
}

function hasVerifiedBrowser(c: Context): boolean {
  const now = Date.now()
  for (const [browser, expiresAt] of verifiedBrowsers) {
    if (expiresAt <= now) verifiedBrowsers.delete(browser)
  }
  const browser = getCookie(c, SETUP_ACCESS_COOKIE)
  return browser !== undefined && verifiedBrowsers.has(browser)
}

/** Whether this request may create the first admin. */
export function hasSetupAccess(c: Context): boolean {
  return !setupTokenEnforced() || hasVerifiedBrowser(c)
}

/** Forget verified browsers and the generated token once the admin exists. */
export function endSetupAccess(c: Context): void {
  verifiedBrowsers.clear()
  generatedToken = null
  announced = false
  deleteCookie(c, SETUP_ACCESS_COOKIE, {
    path: SETUP_ACCESS_COOKIE_PATH,
    secure: secureCookies(),
  })
}

export const SETUP_ACCESS_REQUIRED = "Enter the setup token first."
