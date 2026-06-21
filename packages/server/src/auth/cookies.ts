import { env } from "@alloy/server/env"
import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"

const ACCESS_COOKIE = "alloy_access"
const REFRESH_COOKIE = "alloy_refresh"
const LEGACY_SESSION_COOKIE = "alloy_session"
const AUTH_MARKER_COOKIE = "alloy_is_authenticated"
const OAUTH_STATE_COOKIE_PREFIX = "alloy_oauth_state_"
const ACCESS_MAX_AGE_SEC = 15 * 60
const REFRESH_MAX_AGE_SEC = 30 * 24 * 60 * 60
const OAUTH_STATE_MAX_AGE_SEC = 10 * 60

export type SessionCookieTokens = {
  accessToken: string
  refreshToken: string
}

function secureCookies(): boolean {
  return new URL(env.PUBLIC_SERVER_URL).protocol === "https:"
}

export function readAccessCookie(c: Context): string | null {
  return getCookie(c, ACCESS_COOKIE) ?? null
}

export function readRefreshCookie(c: Context): string | null {
  return getCookie(c, REFRESH_COOKIE) ?? null
}

export function readLegacySessionCookie(c: Context): string | null {
  return getCookie(c, LEGACY_SESSION_COOKIE) ?? null
}

export function setSessionCookies(
  c: Context,
  tokens: SessionCookieTokens,
): void {
  const secure = secureCookies()
  setCookie(c, ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: ACCESS_MAX_AGE_SEC,
  })
  setCookie(c, REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: REFRESH_MAX_AGE_SEC,
  })
  setCookie(c, AUTH_MARKER_COOKIE, "true", {
    httpOnly: false,
    sameSite: "Lax",
    secure,
    path: "/",
    maxAge: REFRESH_MAX_AGE_SEC,
  })
  deleteCookie(c, REFRESH_COOKIE, { path: "/api/auth", secure })
  deleteCookie(c, LEGACY_SESSION_COOKIE, { path: "/", secure })
}

export function clearSessionCookies(c: Context): void {
  const secure = secureCookies()
  deleteCookie(c, ACCESS_COOKIE, { path: "/", secure })
  deleteCookie(c, REFRESH_COOKIE, { path: "/", secure })
  deleteCookie(c, REFRESH_COOKIE, { path: "/api/auth", secure })
  deleteCookie(c, LEGACY_SESSION_COOKIE, { path: "/", secure })
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
