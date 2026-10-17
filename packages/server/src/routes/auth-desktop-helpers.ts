const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])
// Matches `auth_session_device_name_check`, counted in code points.
const DEVICE_NAME_MAX_LENGTH = 64

/**
 * Display name for the computer the desktop app signed in from. The app sends
 * the OS computer name, so odd input is tidied up rather than rejected: a
 * strange hostname must never block sign-in.
 */
export function normalizeDeviceName(value: string | undefined): string | null {
  if (!value) return null
  const cleaned = value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
  return (
    Array.from(cleaned).slice(0, DEVICE_NAME_MAX_LENGTH).join("").trim() || null
  )
}

/**
 * Web page that renders the desktop-link confirmation UI. The API's
 * GET /authorize redirects here instead of serving its own HTML, so the
 * page shares the web app's auth frame and styles.
 */
export const DESKTOP_AUTHORIZE_WEB_PATH = "/desktop/authorize"

/**
 * Same-origin URL for the desktop-link confirmation page. The authorize
 * form posts back to this server and the response redirects the browser to
 * the app's loopback listener.
 */
export function desktopAuthorizeWebUrl(
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
  })
  return `${DESKTOP_AUTHORIZE_WEB_PATH}?${params.toString()}`
}

/**
 * `form-action` sources for the desktop callback. The desktop authorize page
 * posts to this server and the response redirects the browser to the app's
 * loopback listener; Chromium enforces `form-action` on that redirect, so
 * without these entries it drops the final hop and desktop sign-in never
 * completes. IPv6 loopback is absent because CSP host sources cannot express an
 * IPv6 address.
 */
export const LOOPBACK_FORM_ACTION_SOURCES = [
  "http://127.0.0.1:*",
  "http://localhost:*",
]

export function loopbackRedirect(value: string | null | undefined): URL | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "http:") return null
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null
  return url
}
