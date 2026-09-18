const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

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
