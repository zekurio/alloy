import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import { getCookie, setCookie } from "hono/cookie"
import type { Context } from "hono"

import { getAuth } from "../auth"
import { env } from "../env"

const COOKIE_NAME = "alloy_viewer"
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60

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
 * Resolve the viewer for a public-ish endpoint. Session lookup first;
 * fall back to cookie; mint a fresh anon id if neither works.
 */
export async function resolveViewer(c: Context): Promise<ResolvedViewer> {
  const session = await getAuth().api.getSession({
    headers: c.req.raw.headers,
  })
  if (session) {
    return {
      viewerKey: `user:${session.user.id}`,
      userId: session.user.id,
      cookieToSet: null,
    }
  }

  const raw = getCookie(c, COOKIE_NAME)
  const existing = raw ? verifyCookie(raw) : null
  if (existing) {
    return {
      viewerKey: `anon:${existing}`,
      userId: null,
      cookieToSet: null,
    }
  }

  const fresh = randomUUID()
  return {
    viewerKey: `anon:${fresh}`,
    userId: null,
    cookieToSet: signCookie(fresh),
  }
}

export function applyViewerCookie(c: Context, value: string | null): void {
  if (value === null) return
  setCookie(c, COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "Lax",
    secure: c.req.url.startsWith("https://"),
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  })
}

function signCookie(uuid: string): string {
  const mac = hmac(uuid)
  return `${uuid}.${mac}`
}

function verifyCookie(raw: string): string | null {
  const dot = raw.indexOf(".")
  if (dot <= 0 || dot === raw.length - 1) return null
  const uuid = raw.slice(0, dot)
  const provided = raw.slice(dot + 1)
  const expected = hmac(uuid)
  const providedBuf = Buffer.from(provided, "utf8")
  const expectedBuf = Buffer.from(expected, "utf8")
  if (providedBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null
  return uuid
}

function hmac(value: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(value)
    .digest("base64url")
}
