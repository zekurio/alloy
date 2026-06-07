import { session, type Session } from "electron"

import { isAllowedMainSessionPermission } from "./permissions"

/**
 * Persistent session partition for the main window. The Alloy session cookie
 * lives here so the user stays logged in across restarts; it's also where the
 * browser-login handshake injects the session it obtains.
 */
export const MAIN_PARTITION = "persist:alloy"

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
  token: string,
  expiresAt: string,
): Promise<void> {
  const ses = mainSession()
  const secure = new URL(serverUrl).protocol === "https:"
  const expirationDate = Math.floor(new Date(expiresAt).getTime() / 1000)

  await ses.cookies.set({
    url: serverUrl,
    name: "alloy_session",
    value: token,
    httpOnly: true,
    secure,
    sameSite: "lax",
    expirationDate,
  })
  // Non-httpOnly marker the web app uses for optimistic "is authenticated" UI.
  await ses.cookies.set({
    url: serverUrl,
    name: "alloy_is_authenticated",
    value: "true",
    httpOnly: false,
    secure,
    sameSite: "lax",
    expirationDate,
  })
}

/**
 * Check whether the main partition already holds a valid session for this
 * server, so we can skip the browser-login handshake on reconnect. Reads the
 * stored session cookie and validates it against `/api/auth/session`.
 */
export async function hasValidSession(serverUrl: string): Promise<boolean> {
  const [cookie] = await mainSession().cookies.get({
    url: serverUrl,
    name: "alloy_session",
  })
  if (!cookie) return false

  try {
    const res = await fetch(new URL("/api/auth/session", serverUrl), {
      headers: { Cookie: `alloy_session=${cookie.value}` },
    })
    if (!res.ok) return false
    const body: unknown = await res.json()
    return (
      typeof body === "object" &&
      body !== null &&
      "user" in body &&
      body.user !== null
    )
  } catch {
    return false
  }
}
