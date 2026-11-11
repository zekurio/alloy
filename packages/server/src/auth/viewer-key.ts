import type { Context } from "hono"
import { getCookie, setCookie } from "hono/cookie"

import { secureCookies } from "./cookies"
import { getSession } from "./session"

const COOKIE_NAME = "alloy_viewer"
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60
const VIEWER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface ResolvedViewer {
  /**
   * Opaque, namespaced key suitable for hashing into a cache key. Never
   * collides between signed-in and anonymous viewers.
   */
  viewerKey: string
  userId: string | null
  cookieToSet: string | null
}

/**
 * Resolve the viewer for a public-ish endpoint. Session lookup first; fall
 * back to the cookie; mint a fresh anonymous id if neither works.
 *
 * The anonymous id is a bare random uuid, not signed: a client that drops
 * the cookie gets a fresh id anyway, so one that writes its own gains
 * nothing. Anything that isn't a lowercase uuid gets a fresh id.
 */
export async function resolveViewer(c: Context): Promise<ResolvedViewer> {
  const session = await getSession(c)
  if (session) {
    return {
      viewerKey: `user:${session.user.id}`,
      userId: session.user.id,
      cookieToSet: null,
    }
  }

  const existing = getCookie(c, COOKIE_NAME)
  if (existing && VIEWER_ID_RE.test(existing)) {
    return {
      viewerKey: `anon:${existing}`,
      userId: null,
      cookieToSet: null,
    }
  }

  const fresh = crypto.randomUUID()
  return {
    viewerKey: `anon:${fresh}`,
    userId: null,
    cookieToSet: fresh,
  }
}

export function applyViewerCookie(c: Context, value: string | null): void {
  if (value === null) return
  setCookie(c, COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookies(),
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  })
}
