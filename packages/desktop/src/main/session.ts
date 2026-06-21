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
const LEGACY_SESSION_COOKIE = "alloy_session"
const AUTH_MARKER_COOKIE = "alloy_is_authenticated"

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
  // Non-httpOnly marker the web app uses for optimistic "is authenticated" UI.
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
  await ses.cookies
    .remove(new URL("/api/auth/refresh", serverUrl).toString(), REFRESH_COOKIE)
    .catch(() => {})
  await ses.cookies.remove(serverUrl, LEGACY_SESSION_COOKIE).catch(() => {})
}

/**
 * Check whether the main partition holds a locally unexpired session cookie for
 * this server. Network validation happens after the app UI is visible through
 * the normal web session flow, so startup never waits on a remote auth probe.
 */
export async function hasValidSession(serverUrl: string): Promise<boolean> {
  const [refreshCookie] = await mainSession().cookies.get({
    url: serverUrl,
    name: REFRESH_COOKIE,
  })
  if (isUnexpiredCookie(refreshCookie)) return true

  const [legacyCookie] = await mainSession().cookies.get({
    url: serverUrl,
    name: LEGACY_SESSION_COOKIE,
  })
  return isUnexpiredCookie(legacyCookie)
}

function isUnexpiredCookie(cookie: Electron.Cookie | undefined): boolean {
  if (!cookie) return false
  if (!cookie.expirationDate) return true
  return cookie.expirationDate > Date.now() / 1000
}
