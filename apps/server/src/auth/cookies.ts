import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

import { env } from "../env"

const SESSION_COOKIE = "alloy_session"
const AUTH_MARKER_COOKIE = "alloy_is_authenticated"
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60

function secureCookies(): boolean {
  return new URL(env.PUBLIC_SERVER_URL).protocol === "https:"
}

export function readSessionCookie(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null
}

export function setSessionCookies(c: Context, token: string): void {
  const secure = secureCookies()
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  })
  setCookie(c, AUTH_MARKER_COOKIE, "true", {
    httpOnly: false,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  })
}

export function clearSessionCookies(c: Context): void {
  const secure = secureCookies()
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure })
  deleteCookie(c, AUTH_MARKER_COOKIE, { path: "/", secure })
}
