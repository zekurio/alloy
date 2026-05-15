import { getCookie, setCookie } from "hono/cookie"
import type { Context } from "hono"

import { configStore } from "../config/store"
import { getSession } from "./session"
import { base64UrlToBytes, bytesToBase64Url } from "./tokens"

const COOKIE_NAME = "alloy_viewer"
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60
const textEncoder = new TextEncoder()

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
  const session = await getSession(c)
  if (session) {
    return {
      viewerKey: `user:${session.user.id}`,
      userId: session.user.id,
      cookieToSet: null,
    }
  }

  const raw = getCookie(c, COOKIE_NAME)
  const existing = raw ? await verifyCookie(raw) : null
  if (existing) {
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
    cookieToSet: await signCookie(fresh),
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

async function signCookie(uuid: string): Promise<string> {
  const mac = await hmac(uuid)
  return `${uuid}.${mac}`
}

async function verifyCookie(raw: string): Promise<string | null> {
  const dot = raw.indexOf(".")
  if (dot <= 0 || dot === raw.length - 1) return null
  const uuid = raw.slice(0, dot)
  const provided = raw.slice(dot + 1)
  const expected = await hmac(uuid)
  let providedBytes: Uint8Array
  try {
    providedBytes = base64UrlToBytes(provided)
  } catch {
    return null
  }
  if (!timingSafeEqual(providedBytes, base64UrlToBytes(expected))) {
    return null
  }
  return uuid
}

async function hmac(value: string): Promise<string> {
  const { viewerCookieSecret } = configStore.get("secrets")
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(viewerCookieSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(value)
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
