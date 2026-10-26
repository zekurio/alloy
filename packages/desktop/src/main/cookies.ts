import type { Cookie, Session } from "electron"

import { asError, log } from "./log"
import type { SessionToken } from "./native"

/** The cookie that carries an Alloy session. */
const SESSION_COOKIE = "alloy_session"
/**
 * Cookies from before sessions stopped rotating. An upgraded server still
 * accepts the refresh cookie as the session token until the web app's next
 * session check replaces it with `SESSION_COOKIE`.
 */
const LEGACY_ACCESS_COOKIE = "alloy_access"
const LEGACY_REFRESH_COOKIE = "alloy_refresh"
const SESSION_COOKIES = [
  SESSION_COOKIE,
  LEGACY_ACCESS_COOKIE,
  LEGACY_REFRESH_COOKIE,
]
/** How long after a session cookie changes the cookie store is written out. */
const COOKIE_FLUSH_DELAY_MS = 100

function isUnexpired(cookie: Cookie): boolean {
  return (
    cookie.expirationDate === undefined ||
    cookie.expirationDate > Date.now() / 1000
  )
}

/**
 * Whether the profile kept a session from an earlier sign-in. A legacy
 * `alloy_refresh` cookie also counts: an upgraded server accepts it as the
 * session token and replaces it once the web app loads. Nothing is checked
 * over the network, so a server that is briefly unreachable is no sign-out.
 */
export async function hasSavedSession(
  session: Session,
  origin: string,
): Promise<boolean> {
  const cookies = await session.cookies.get({ url: `${origin}/` })
  return cookies.some(
    (cookie) =>
      (cookie.name === SESSION_COOKIE ||
        cookie.name === LEGACY_REFRESH_COOKIE) &&
      cookie.value !== "" &&
      isUnexpired(cookie),
  )
}

/**
 * Stores the token from a browser sign-in as the session cookie the server
 * itself sets: host-only, at `/`, HttpOnly. The server renews this cookie in
 * place, and its sign-out removes it.
 */
export async function storeSessionToken(
  session: Session,
  origin: string,
  token: SessionToken,
): Promise<void> {
  // The sign-in can finish a while before the window gets its cookie.
  if (token.expiresAt <= Date.now() / 1000) {
    throw new Error("The login session has expired. Connect again.")
  }
  // A previous host-only or domain cookie must not shadow this login.
  await clearSessionCookies(session, origin)
  await session.cookies
    .set({
      url: `${origin}/`,
      name: SESSION_COOKIE,
      value: token.token,
      path: "/",
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "lax",
      expirationDate: token.expiresAt,
    })
    .catch((cause: Error) => {
      log.warn("Could not store the Alloy session cookie. %s", cause)
      throw new Error("Could not store the Alloy session cookie.")
    })
  await flushCookies(session)
}

/**
 * Removes every Alloy session cookie for the server's host: host-only and
 * domain-scoped copies, legacy names, and stale path variants.
 */
export async function clearSessionCookies(
  session: Session,
  origin: string,
): Promise<void> {
  const host = new URL(origin).hostname
  try {
    const cookies = await session.cookies.get({ domain: host })
    for (const cookie of cookies) {
      const domain = cookie.domain?.replace(/^\./, "")
      if (domain !== host || !SESSION_COOKIES.includes(cookie.name)) continue
      await session.cookies.remove(
        `${origin}${cookie.path ?? "/"}`,
        cookie.name,
      )
    }
  } catch (cause) {
    log.warn("Native session cookie cleanup failed. %s", asError(cause))
    throw new Error("Could not clear the native session cookies.")
  }
  await flushCookies(session)
}

/**
 * The `Cookie` header for clip downloads from the selected server. Never the
 * legacy refresh cookie: a server from before sessions stopped rotating
 * would spend it on this request, and the window would keep the spent token.
 */
export async function sessionCookieHeader(
  session: Session,
  origin: string,
): Promise<string> {
  const cookies = await session.cookies.get({ url: `${origin}/` })
  return cookies
    .filter(
      (cookie) =>
        cookie.name === SESSION_COOKIE || cookie.name === LEGACY_ACCESS_COOKIE,
    )
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ")
}

const watched = new WeakSet<Session>()

/**
 * Writes session cookie changes the server makes to disk promptly. Windows
 * can end the app during a restart without Electron's quit path, and
 * Chromium's own periodic write could then lose a fresh session.
 */
export function watchSessionCookies(session: Session): void {
  if (watched.has(session)) return
  watched.add(session)
  let timer: ReturnType<typeof setTimeout> | null = null
  session.cookies.on("changed", (_event, cookie) => {
    if (!SESSION_COOKIES.includes(cookie.name)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flushCookies(session)
    }, COOKIE_FLUSH_DELAY_MS)
  })
}

export async function flushCookies(session: Session): Promise<void> {
  await session.cookies.flushStore().catch(() => undefined)
}
