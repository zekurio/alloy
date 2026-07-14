import { session, type Session } from "electron"

import { isAllowedMainSessionPermission } from "./permissions"

/**
 * Persistent session partition for the main window. The Alloy session cookie
 * lives here so the user stays logged in across restarts; it's also where the
 * browser-login handshake injects the session it obtains.
 */
export const MAIN_PARTITION = "persist:alloy"
const ACCESS_COOKIE = "alloy_access"
const REFRESH_COOKIE = "alloy_refresh"
const AUTH_MARKER_COOKIE = "alloy_is_authenticated"
const AUTH_COOKIE_FLUSH_DELAY_MS = 100
const AUTH_COOKIE_NAMES = [ACCESS_COOKIE, REFRESH_COOKIE] as const

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

/**
 * Drop cached remote web assets before loading a server after reconnect or
 * upgrade. Keep cookies/storage intact so authenticated sessions survive.
 */
export function clearRemoteWebCache(): Promise<void> {
  return mainSession().clearCache()
}

/**
 * The main partition loads server-provided web content. Keep browser
 * permissions deny-by-default; future native features should request OS
 * permissions from trusted main/preload code, not from remote page JS.
 */
export function hardenMainSessionPermissions(): void {
  const ses = mainSession()
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isAllowedMainSessionPermission(permission))
  })
  ses.setPermissionCheckHandler((_webContents, permission) =>
    isAllowedMainSessionPermission(permission),
  )
}

/**
 * Flush auth-cookie changes made by remote web responses promptly. Windows can
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
 * server. This deliberately performs no network validation: normal web
 * navigation is the single owner of refresh-token rotation, and a transient
 * startup network failure must not be interpreted as a logout.
 */
export async function hasStoredSession(serverUrl: string): Promise<boolean> {
  return (await mainSession().cookies.get({ url: serverUrl })).some(
    (cookie) => isAuthCookie(cookie.name) && isUnexpiredCookie(cookie),
  )
}

/**
 * Write the session obtained from the browser-login handshake into the main
 * partition's cookie jar, so the main window loads the server already
 * authenticated. Mirrors the cookies the server sets on a normal login.
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
  return isAuthCookie(name) || name === AUTH_MARKER_COOKIE
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
