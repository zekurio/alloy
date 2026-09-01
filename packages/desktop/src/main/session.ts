import { session, type Session } from "electron"

import { isAllowedMainSessionPermission } from "./permissions"
import { sameOrigin } from "./url-policy"

/**
 * Persistent session partition for the server-hosted main window. HttpOnly
 * server cookies stay in Chromium and are sent through normal same-origin
 * requests.
 */
export const MAIN_PARTITION = "persist:alloy"
const ACCESS_COOKIE = "alloy_access"
const REFRESH_COOKIE = "alloy_refresh"
const AUTH_MARKER_COOKIE = "alloy_is_authenticated"
const AUTH_COOKIE_FLUSH_DELAY_MS = 100
const AUTH_COOKIE_NAMES = [ACCESS_COOKIE, REFRESH_COOKIE] as const
const MANAGED_COOKIE_NAMES = [
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  AUTH_MARKER_COOKIE,
] as const

let watchingAuthCookiePersistence = false
let authCookieFlushTimer: ReturnType<typeof setTimeout> | null = null

type DesktopSessionTokens = {
  accessToken: string
  refreshToken: string
  accessExpiresAt: string
  refreshExpiresAt: string
}

export function mainSession(): Session {
  return session.fromPartition(MAIN_PARTITION)
}

/** Keep renderer permission requests deny-by-default. */
export function hardenMainSessionPermissions(serverOrigin: string): void {
  const ses = mainSession()
  ses.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        details.isMainFrame &&
          sameOrigin(details.requestingUrl, serverOrigin) &&
          sameOrigin(webContents.getURL(), serverOrigin) &&
          isAllowedMainSessionPermission(permission),
      )
    },
  )
  ses.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      Boolean(
        webContents &&
        details.isMainFrame &&
        sameOrigin(requestingOrigin, serverOrigin) &&
        sameOrigin(webContents.getURL(), serverOrigin) &&
        isAllowedMainSessionPermission(permission),
      ),
  )
}

/**
 * Flush auth-cookie changes made by server API responses promptly. Windows can
 * terminate applications without Electron's asynchronous quit path during a
 * reboot, so relying on Chromium's eventual cookie-store flush can leave an
 * already-rotated refresh token only in memory.
 */
export function watchAuthCookiePersistence(): void {
  if (watchingAuthCookiePersistence) return
  watchingAuthCookiePersistence = true

  mainSession().cookies.on("changed", (_event, cookie) => {
    if (!isManagedAuthCookie(cookie.name)) return
    scheduleCookieStoreFlush()
  })
}

/**
 * Report whether this installation has a locally usable credential for the
 * server. This deliberately performs no network validation: the hosted app
 * owns refresh-token rotation, and a transient startup network failure must
 * not be interpreted as a logout.
 */
export async function hasStoredSession(serverUrl: string): Promise<boolean> {
  return (await mainSession().cookies.get({ url: serverUrl })).some(
    (cookie) => isAuthCookie(cookie.name) && isUnexpiredCookie(cookie),
  )
}

/** Remove only Alloy auth cookies visible to one forgotten server. */
export async function clearServerAuthCookies(serverUrl: string): Promise<void> {
  const url = new URL(serverUrl).origin
  await Promise.all(
    MANAGED_COOKIE_NAMES.map((name) => mainSession().cookies.remove(url, name)),
  )
  await flushCookieStore()
}

/**
 * Write the session obtained from browser login into the main window's cookie
 * jar. Mirrors the cookies the server sets on a normal login.
 */
export async function injectSessionCookie(
  serverUrl: string,
  tokens: DesktopSessionTokens,
): Promise<void> {
  const ses = mainSession()
  const secure = new URL(serverUrl).protocol === "https:"
  const accessExpirationDate = Math.floor(
    new Date(tokens.accessExpiresAt).getTime() / 1000,
  )
  const refreshExpirationDate = Math.floor(
    new Date(tokens.refreshExpiresAt).getTime() / 1000,
  )

  await ses.cookies.set({
    url: serverUrl,
    name: ACCESS_COOKIE,
    value: tokens.accessToken,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expirationDate: accessExpirationDate,
  })
  await ses.cookies.set({
    url: serverUrl,
    name: REFRESH_COOKIE,
    value: tokens.refreshToken,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expirationDate: refreshExpirationDate,
  })
  await ses.cookies.set({
    url: serverUrl,
    name: AUTH_MARKER_COOKIE,
    value: "true",
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    expirationDate: refreshExpirationDate,
  })
  await flushCookieStore()
}

function isUnexpiredCookie(cookie: Electron.Cookie): boolean {
  if (!cookie.expirationDate) return true
  return cookie.expirationDate > Date.now() / 1000
}

function isAuthCookie(name: string): boolean {
  return AUTH_COOKIE_NAMES.some((cookieName) => cookieName === name)
}

function isManagedAuthCookie(name: string): boolean {
  return MANAGED_COOKIE_NAMES.some((cookieName) => cookieName === name)
}

function scheduleCookieStoreFlush(): void {
  if (authCookieFlushTimer) clearTimeout(authCookieFlushTimer)
  authCookieFlushTimer = setTimeout(() => {
    authCookieFlushTimer = null
    void flushCookieStore()
  }, AUTH_COOKIE_FLUSH_DELAY_MS)
  authCookieFlushTimer.unref?.()
}

async function flushCookieStore(): Promise<void> {
  await mainSession()
    .cookies.flushStore()
    .catch(() => undefined)
}
