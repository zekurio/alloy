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
const SESSION_VALIDATION_TIMEOUT_MS = 10_000
const AUTH_COOKIE_NAMES = [
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  LEGACY_SESSION_COOKIE,
] as const

type DesktopSessionTokens = {
  accessToken: string
  refreshToken: string
  accessExpiresAt: string
  refreshExpiresAt: string
}

type SetCookieHeaders = Headers & { getSetCookie?: () => string[] }
type ParsedSetCookie = {
  name: string
  value: string
  domain?: string
  path: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
  expired: boolean
  sameSite?: Electron.CookiesSetDetails["sameSite"]
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
 * Check whether the main partition holds a server-valid session for this
 * server. The session endpoint may rotate refresh tokens while validating, so
 * any returned Set-Cookie headers are persisted back into Electron's jar before
 * the remote app is loaded.
 */
export async function hasValidSession(
  serverUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  const cookie = await authCookieHeader(serverUrl)
  if (!cookie) return false

  try {
    const res = await fetch(new URL("/api/auth/session", serverUrl), {
      headers: { Cookie: cookie },
      signal:
        (options.timeoutMs ?? SESSION_VALIDATION_TIMEOUT_MS) > 0
          ? AbortSignal.timeout(
              options.timeoutMs ?? SESSION_VALIDATION_TIMEOUT_MS,
            )
          : undefined,
    })
    await persistResponseCookies(serverUrl, res.headers)
    if (!res.ok) return false

    const body: unknown = await res.json()
    return isSessionData(body)
  } catch {
    return false
  }
}

function isUnexpiredCookie(cookie: Electron.Cookie | undefined): boolean {
  if (!cookie) return false
  if (!cookie.expirationDate) return true
  return cookie.expirationDate > Date.now() / 1000
}

async function authCookieHeader(serverUrl: string): Promise<string> {
  return (await mainSession().cookies.get({ url: serverUrl }))
    .filter((cookie) => isAuthCookie(cookie.name) && isUnexpiredCookie(cookie))
    .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
    .join("; ")
}

function isAuthCookie(name: string): boolean {
  return AUTH_COOKIE_NAMES.some((cookieName) => cookieName === name)
}

function isManagedAuthCookie(name: string): boolean {
  return isAuthCookie(name) || name === AUTH_MARKER_COOKIE
}

async function persistResponseCookies(
  serverUrl: string,
  headers: Headers,
): Promise<void> {
  for (const header of setCookieHeaders(headers)) {
    const cookie = parseSetCookie(header)
    if (!cookie || !isManagedAuthCookie(cookie.name)) continue
    if (cookie.expired) {
      await mainSession()
        .cookies.remove(cookieUrl(serverUrl, cookie.path), cookie.name)
        .catch(() => undefined)
      continue
    }

    await mainSession().cookies.set({
      url: cookieUrl(serverUrl, cookie.path),
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      sameSite: cookie.sameSite,
    })
  }
}

function setCookieHeaders(headers: Headers): string[] {
  const values = (headers as SetCookieHeaders).getSetCookie?.()
  if (values?.length) return values

  const header = headers.get("set-cookie")
  return header ? splitCombinedSetCookieHeader(header) : []
}

function splitCombinedSetCookieHeader(header: string): string[] {
  const parts: string[] = []
  let start = 0
  let inExpires = false

  for (let i = 0; i < header.length; i += 1) {
    if (header.slice(i, i + 8).toLowerCase() === "expires=") {
      inExpires = true
    }
    if (inExpires && header[i] === ";") inExpires = false
    if (inExpires || header[i] !== ",") continue
    if (!/^\s*[^=;,]+=/u.test(header.slice(i + 1))) continue

    parts.push(header.slice(start, i).trim())
    start = i + 1
  }

  parts.push(header.slice(start).trim())
  return parts.filter(Boolean)
}

function parseSetCookie(header: string): ParsedSetCookie | null {
  const [pair, ...attributes] = header.split(";")
  const separator = pair?.indexOf("=") ?? -1
  if (separator <= 0) return null

  const parsed: ParsedSetCookie = {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1),
    path: "/",
    expired: false,
  }

  for (const attribute of attributes) {
    const separator = attribute.indexOf("=")
    const key = attribute
      .slice(0, separator === -1 ? undefined : separator)
      .trim()
      .toLowerCase()
    const value = separator === -1 ? "" : attribute.slice(separator + 1).trim()

    if (key === "domain") parsed.domain = value
    if (key === "path") parsed.path = value || "/"
    if (key === "secure") parsed.secure = true
    if (key === "httponly") parsed.httpOnly = true
    if (key === "samesite") parsed.sameSite = sameSitePolicy(value)
    if (key === "expires") applyExpires(parsed, value)
    if (key === "max-age") applyMaxAge(parsed, value)
  }

  if (!parsed.name) return null
  return parsed
}

function applyExpires(cookie: ParsedSetCookie, value: string): void {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return
  cookie.expirationDate = Math.floor(timestamp / 1000)
  cookie.expired = cookie.expirationDate <= Date.now() / 1000
}

function applyMaxAge(cookie: ParsedSetCookie, value: string): void {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return
  cookie.expired = seconds <= 0
  cookie.expirationDate = Math.floor(Date.now() / 1000 + seconds)
}

function sameSitePolicy(value: string): Electron.CookiesSetDetails["sameSite"] {
  if (value.toLowerCase() === "none") return "no_restriction"
  if (value.toLowerCase() === "strict") return "strict"
  if (value.toLowerCase() === "lax") return "lax"
  return "unspecified"
}

function cookieUrl(serverUrl: string, path: string): string {
  return new URL(path || "/", serverUrl).toString()
}

function isSessionData(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const session = (value as { session?: unknown }).session
  const user = (value as { user?: unknown }).user
  return Boolean(session && typeof session === "object" && user)
}
