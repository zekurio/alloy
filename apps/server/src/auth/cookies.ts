import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

import { env } from "../env"

const SESSION_COOKIE = "alloy_session"
const AUTH_MARKER_COOKIE = "alloy_is_authenticated"
const OAUTH_STATE_COOKIE_PREFIX = "alloy_oauth_state_"
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60
const OAUTH_STATE_MAX_AGE_SEC = 10 * 60

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

function oauthStateCookieName(providerId: string): string {
  return `${OAUTH_STATE_COOKIE_PREFIX}${providerId}`
}

function oauthStateCookiePath(providerId: string): string {
  return `/api/auth/oauth2/callback/${providerId}`
}

export function readOAuthStateCookie(
  c: Context,
  providerId: string
): string | null {
  return getCookie(c, oauthStateCookieName(providerId)) ?? null
}

export function setOAuthStateCookie(
  c: Context,
  providerId: string,
  value: string
): void {
  setCookie(c, oauthStateCookieName(providerId), value, {
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookies(),
    path: oauthStateCookiePath(providerId),
    maxAge: OAUTH_STATE_MAX_AGE_SEC,
  })
}

export function clearOAuthStateCookie(c: Context, providerId: string): void {
  deleteCookie(c, oauthStateCookieName(providerId), {
    path: oauthStateCookiePath(providerId),
    secure: secureCookies(),
  })
}
