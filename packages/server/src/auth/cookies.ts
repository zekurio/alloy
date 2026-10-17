import { env } from "@alloy/server/env"
import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

const SESSION_COOKIE = "alloy_session"
// Sessions used to rotate an access/refresh pair. The migration that removed
// rotation made each live refresh token its session's token, so a leftover
// refresh cookie still signs in until `GET /api/auth/session` replaces it.
const LEGACY_ACCESS_COOKIE = "alloy_access"
const LEGACY_REFRESH_COOKIE = "alloy_refresh"
const AUTH_MARKER_COOKIE = "alloy_is_authenticated"
const ACCOUNT_REACTIVATION_COOKIE = "alloy_account_reactivation"
const OAUTH_STATE_COOKIE_PREFIX = "alloy_oauth_state_"
// Chromium's cap on cookie lifetimes. The session itself expires server-side
// after a period without use; `GET /api/auth/session` renews the cookie.
export const SESSION_COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60
const OAUTH_STATE_MAX_AGE_SEC = 10 * 60
const ACCOUNT_REACTIVATION_MAX_AGE_SEC = 10 * 60

function secureCookies(): boolean {
  return (
    env.NODE_ENV === "production" ||
    new URL(env.PUBLIC_SERVER_URL).protocol === "https:"
  )
}

export function readSessionToken(c: Context): string | null {
  return (
    getCookie(c, SESSION_COOKIE) || getCookie(c, LEGACY_REFRESH_COOKIE) || null
  )
}

export function setSessionCookie(c: Context, token: string): void {
  const secure = secureCookies()
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
  })
  setCookie(c, AUTH_MARKER_COOKIE, "true", {
    httpOnly: false,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SEC,
  })
}

export function clearSessionCookies(c: Context): void {
  const secure = secureCookies()
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure })
  deleteCookie(c, LEGACY_ACCESS_COOKIE, { path: "/", secure })
  deleteCookie(c, LEGACY_REFRESH_COOKIE, { path: "/", secure })
  deleteCookie(c, AUTH_MARKER_COOKIE, { path: "/", secure })
  deleteCookie(c, ACCOUNT_REACTIVATION_COOKIE, {
    path: "/api/auth/reactivate",
    secure,
  })
}

export function readAccountReactivationCookie(c: Context): string | null {
  return getCookie(c, ACCOUNT_REACTIVATION_COOKIE) ?? null
}

export function setAccountReactivationCookie(c: Context, token: string): void {
  setCookie(c, ACCOUNT_REACTIVATION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookies(),
    path: "/api/auth/reactivate",
    maxAge: ACCOUNT_REACTIVATION_MAX_AGE_SEC,
  })
}

export function clearAccountReactivationCookie(c: Context): void {
  deleteCookie(c, ACCOUNT_REACTIVATION_COOKIE, {
    path: "/api/auth/reactivate",
    secure: secureCookies(),
  })
}

function oauthStateCookieName(providerId: string): string {
  return `${OAUTH_STATE_COOKIE_PREFIX}${providerId}`
}

function oauthStateCookiePath(providerId: string): string {
  return `/api/auth/oauth2/callback/${providerId}`
}

export function readOAuthStateCookie(
  c: Context,
  providerId: string,
): string | null {
  return getCookie(c, oauthStateCookieName(providerId)) ?? null
}

export function setOAuthStateCookie(
  c: Context,
  providerId: string,
  value: string,
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
