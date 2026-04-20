import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import { getCookie, setCookie } from "hono/cookie"
import type { Context } from "hono"

import { getAuth } from "../auth"
import { env } from "../env"

/**
 * Per-viewer identity for dedup. `/api/clips/:id/view` needs a stable
 * identifier to hash into the cache key so the same viewer doesn't get
 * counted twice inside the 24h window. Two sources:
 *
 *   - Signed-in viewers: the better-auth session's user id, prefixed
 *     `user:` so the keyspace never collides with anonymous keys.
 *   - Anonymous viewers: a random uuid persisted in the `alloy_viewer`
 *     cookie, signed with `BETTER_AUTH_SECRET` so a client can't mint a
 *     new one per hit to farm view counts. Prefixed `anon:`.
 *
 * The signed cookie payload is `<uuid>.<base64url-hmac>`. A tampered or
 * malformed cookie is treated as absent — we just mint a new one. The
 * worst case of a forgery is that the attacker chose their own uuid
 * (which is fine, uuids are the identifier) so the HMAC is mostly
 * defence against an attacker deleting-and-recreating the cookie per
 * request, which would otherwise count every hit.
 *
 * Resolution is best-effort: if we mint a new cookie on this request,
 * the caller needs to set it on the response before returning so the
 * same id persists for the next hit.
 */

const COOKIE_NAME = "alloy_viewer"
// One year. Long enough that a returning viewer keeps the same id for
// practical purposes; short enough that a shared device doesn't keep a
// stale id forever. Refreshed on every successful resolution so an
// active viewer never ages out.
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60

export interface ResolvedViewer {
  /**
   * Opaque, namespaced key suitable for hashing into a cache key. Never
   * collides between signed-in and anonymous viewers.
   */
  viewerKey: string
  /**
   * When set, the caller must echo this cookie back on the response so
   * the browser persists the anon id. `null` when the viewer is signed
   * in (no cookie needed) or when the existing cookie was valid.
   */
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
    return { viewerKey: `user:${session.user.id}`, cookieToSet: null }
  }

  const raw = getCookie(c, COOKIE_NAME)
  const existing = raw ? verifyCookie(raw) : null
  if (existing) {
    return { viewerKey: `anon:${existing}`, cookieToSet: null }
  }

  const fresh = randomUUID()
  return { viewerKey: `anon:${fresh}`, cookieToSet: signCookie(fresh) }
}

/**
 * Set the anon cookie on the response, if `resolveViewer` minted a
 * fresh one. No-op when `cookieToSet` is null — cheap to call
 * unconditionally from the handler's success path.
 */
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

// ─── HMAC helpers ──────────────────────────────────────────────────────

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
  // Constant-time compare to avoid leaking the correct HMAC byte-by-byte.
  // Length-mismatch short-circuits before `timingSafeEqual` (which
  // requires equal-length buffers) to avoid a throw on malformed input.
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
