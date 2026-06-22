import {
  type AuthSession,
  authRefreshToken,
  authSession,
  type User,
  user,
} from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import { forbidden, unauthorized } from "@alloy/server/runtime/http-response"
import { requestIp } from "@alloy/server/runtime/request-ip"
import { and, eq, gt, isNull } from "drizzle-orm"
import type { Context } from "hono"
import { createMiddleware } from "hono/factory"

import {
  clearSessionCookies,
  readAccessCookie,
  readRefreshCookie,
  setSessionCookies,
  type SessionCookieTokens,
} from "./cookies"
import { generateSessionToken, hashSessionToken } from "./tokens"

export const ACCESS_TTL_MS = 15 * 60 * 1000
export const REFRESH_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const REFRESH_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000
const SESSION_TOUCH_MS = 60 * 60 * 1000
const REFRESH_REUSE_GRACE_MS = 10 * 1000

type AuthUser = User

type SessionData = {
  session: AuthSession
  user: AuthUser
}

type CreatedSession = {
  tokens: SessionCookieTokens
  data: SessionData
}

type RefreshResult = {
  tokens: SessionCookieTokens | null
  data: SessionData
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

type CachedRefreshResult = {
  expiresAtMs: number
  result: RefreshResult
  timeout: ReturnType<typeof setTimeout>
}

const refreshInFlight = new Map<string, Promise<RefreshResult | null>>()
const refreshResultCache = new Map<string, CachedRefreshResult>()

function accessExpiresAt(now: Date): Date {
  return new Date(now.getTime() + ACCESS_TTL_MS)
}

function refreshIdleExpiresAt(now: Date): Date {
  return new Date(now.getTime() + REFRESH_IDLE_TTL_MS)
}

function refreshAbsoluteExpiresAt(now: Date): Date {
  return new Date(now.getTime() + REFRESH_ABSOLUTE_TTL_MS)
}

function isAfter(value: Date | null, now: Date): boolean {
  return value !== null && value.getTime() > now.getTime()
}

function withinReuseGrace(consumedAt: Date | null, now: Date): boolean {
  return (
    consumedAt !== null &&
    consumedAt.getTime() + REFRESH_REUSE_GRACE_MS > now.getTime()
  )
}

async function revokeSessionFamily(
  tx: Tx,
  sessionId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(authSession)
    .set({ revoked_at: now, updated_at: now })
    .where(eq(authSession.id, sessionId))
  await tx
    .update(authRefreshToken)
    .set({ revoked_at: now, updated_at: now })
    .where(eq(authRefreshToken.session_id, sessionId))
}

async function touchSession(row: SessionData, now: Date): Promise<void> {
  const lastSeenAt = row.session.last_seen_at ?? row.session.updated_at
  if (lastSeenAt.getTime() + SESSION_TOUCH_MS >= now.getTime()) return

  await db
    .update(authSession)
    .set({ last_seen_at: now, updated_at: now })
    .where(eq(authSession.id, row.session.id))
  row.session.last_seen_at = now
  row.session.updated_at = now
}

export async function createSession(
  c: Context,
  userId: string,
): Promise<CreatedSession> {
  const accessToken = generateSessionToken()
  const refreshToken = generateSessionToken()
  const now = new Date()
  const accessHash = await hashSessionToken(accessToken)
  const refreshHash = await hashSessionToken(refreshToken)
  const session = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(authSession)
      .values({
        token_hash: accessHash,
        user_id: userId,
        expires_at: accessExpiresAt(now),
        ip_address: requestIp(c),
        user_agent: c.req.header("user-agent") ?? null,
        last_seen_at: now,
      })
      .returning()
    if (!created) throw new Error("Could not create session.")

    await tx.insert(authRefreshToken).values({
      session_id: created.id,
      token_hash: refreshHash,
      expires_at: refreshIdleExpiresAt(now),
      absolute_expires_at: refreshAbsoluteExpiresAt(now),
    })
    return created
  })

  const data = await selectSessionByAccessHash(session.token_hash)
  if (!data) throw new Error("Could not load session.")
  return { tokens: { accessToken, refreshToken }, data }
}

async function selectSessionByAccessHash(
  tokenHash: string,
): Promise<SessionData | null> {
  const now = new Date()
  const [row] = await db
    .select({ session: authSession, user })
    .from(authSession)
    .innerJoin(user, eq(user.id, authSession.user_id))
    .where(
      and(
        eq(authSession.token_hash, tokenHash),
        gt(authSession.expires_at, now),
        isNull(authSession.revoked_at),
      ),
    )
    .limit(1)
  if (!row) return null
  await touchSession(row, now)
  return row
}

function sessionDataForRefreshGrace(input: {
  session: AuthSession
  user: AuthUser
  consumedAt: Date | null
  now: Date
}): RefreshResult | null {
  if (!withinReuseGrace(input.consumedAt, input.now)) return null
  if (!isAfter(input.session.expires_at, input.now)) return null
  if (input.session.revoked_at) return null

  const data = { session: input.session, user: input.user }
  return { tokens: null, data }
}

async function cachedRefreshResult(
  tokenHash: string,
  now: Date,
): Promise<RefreshResult | null> {
  const cached = refreshResultCache.get(tokenHash)
  if (!cached) return null
  if (cached.expiresAtMs <= now.getTime()) {
    clearTimeout(cached.timeout)
    refreshResultCache.delete(tokenHash)
    return null
  }

  const [active] = await db
    .select({ id: authSession.id })
    .from(authSession)
    .where(
      and(
        eq(authSession.id, cached.result.data.session.id),
        eq(authSession.token_hash, cached.result.data.session.token_hash),
        gt(authSession.expires_at, now),
        isNull(authSession.revoked_at),
      ),
    )
    .limit(1)
  return active ? cached.result : null
}

function cacheRefreshResult(tokenHash: string, result: RefreshResult): void {
  if (!result.tokens) return

  const existing = refreshResultCache.get(tokenHash)
  if (existing) clearTimeout(existing.timeout)

  const expiresAtMs = Date.now() + REFRESH_REUSE_GRACE_MS
  const timeout = setTimeout(() => {
    refreshResultCache.delete(tokenHash)
  }, REFRESH_REUSE_GRACE_MS)
  refreshResultCache.set(tokenHash, { expiresAtMs, result, timeout })
}

async function rotateRefreshSession(
  tokenHash: string,
  now: Date,
): Promise<RefreshResult | null> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        refresh: authRefreshToken,
        session: authSession,
        user,
      })
      .from(authRefreshToken)
      .innerJoin(authSession, eq(authSession.id, authRefreshToken.session_id))
      .innerJoin(user, eq(user.id, authSession.user_id))
      .where(eq(authRefreshToken.token_hash, tokenHash))
      .limit(1)
    if (!row) return null

    if (row.refresh.consumed_at) {
      const grace = sessionDataForRefreshGrace({
        session: row.session,
        user: row.user,
        consumedAt: row.refresh.consumed_at,
        now,
      })
      if (grace) return grace

      await revokeSessionFamily(tx, row.session.id, now)
      return null
    }

    if (
      row.refresh.revoked_at ||
      row.session.revoked_at ||
      row.refresh.expires_at.getTime() <= now.getTime() ||
      row.refresh.absolute_expires_at.getTime() <= now.getTime()
    ) {
      return null
    }

    const [consumed] = await tx
      .update(authRefreshToken)
      .set({ consumed_at: now, last_used_at: now, updated_at: now })
      .where(
        and(
          eq(authRefreshToken.id, row.refresh.id),
          isNull(authRefreshToken.consumed_at),
          isNull(authRefreshToken.revoked_at),
        ),
      )
      .returning()
    if (!consumed) {
      const [current] = await tx
        .select({
          refresh: authRefreshToken,
          session: authSession,
          user,
        })
        .from(authRefreshToken)
        .innerJoin(authSession, eq(authSession.id, authRefreshToken.session_id))
        .innerJoin(user, eq(user.id, authSession.user_id))
        .where(eq(authRefreshToken.id, row.refresh.id))
        .limit(1)
      const grace = current
        ? sessionDataForRefreshGrace({
            session: current.session,
            user: current.user,
            consumedAt: current.refresh.consumed_at,
            now,
          })
        : null
      if (grace) return grace

      await revokeSessionFamily(tx, row.session.id, now)
      return null
    }

    const accessToken = generateSessionToken()
    const refreshToken = generateSessionToken()
    const accessHash = await hashSessionToken(accessToken)
    const refreshHash = await hashSessionToken(refreshToken)
    const absoluteExpiresAt = row.refresh.absolute_expires_at
    const refreshExpiresAt = new Date(
      Math.min(
        refreshIdleExpiresAt(now).getTime(),
        absoluteExpiresAt.getTime(),
      ),
    )

    await tx.insert(authRefreshToken).values({
      session_id: row.session.id,
      token_hash: refreshHash,
      expires_at: refreshExpiresAt,
      absolute_expires_at: absoluteExpiresAt,
    })
    const [session] = await tx
      .update(authSession)
      .set({
        token_hash: accessHash,
        expires_at: accessExpiresAt(now),
        last_seen_at: now,
        updated_at: now,
      })
      .where(eq(authSession.id, row.session.id))
      .returning()
    if (!session) throw new Error("Could not refresh session.")

    return {
      tokens: { accessToken, refreshToken },
      data: { session, user: row.user },
    }
  })
}

async function refreshSessionForToken(
  tokenHash: string,
): Promise<RefreshResult | null> {
  const now = new Date()
  const cached = await cachedRefreshResult(tokenHash, now)
  if (cached) return cached

  const existing = refreshInFlight.get(tokenHash)
  if (existing) return existing

  const startedAt = new Date()
  const promise = rotateRefreshSession(tokenHash, startedAt)
    .then((result) => {
      if (result) cacheRefreshResult(tokenHash, result)
      return result
    })
    .finally(() => {
      refreshInFlight.delete(tokenHash)
    })
  refreshInFlight.set(tokenHash, promise)
  return promise
}

export async function refreshSession(
  c: Context,
): Promise<RefreshResult | null> {
  const token = readRefreshCookie(c)
  if (!token) return null

  const tokenHash = await hashSessionToken(token)
  const result = await refreshSessionForToken(tokenHash)

  if (result?.tokens) setSessionCookies(c, result.tokens)
  if (!result) clearSessionCookies(c)
  return result
}

export async function getSession(
  headers: Headers | Context,
): Promise<SessionData | null> {
  const accessToken =
    "req" in headers
      ? readAccessCookie(headers)
      : cookieTokenFromHeaders(headers, "alloy_access")
  if (accessToken) {
    const data = await selectSessionByAccessHash(
      await hashSessionToken(accessToken),
    )
    if (data) return data
  }

  if ("req" in headers) {
    return (await refreshSession(headers))?.data ?? null
  }
  return null
}

function cookieTokenFromHeaders(
  headers: Headers,
  cookieName: string,
): string | null {
  const cookie = headers.get("cookie")
  if (!cookie) return null
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name !== cookieName) continue
    try {
      return decodeURIComponent(rest.join("="))
    } catch {
      return null
    }
  }
  return null
}

export async function deleteCurrentSession(c: Context): Promise<void> {
  const accessToken = readAccessCookie(c)
  if (accessToken) {
    const [deleted] = await db
      .delete(authSession)
      .where(eq(authSession.token_hash, await hashSessionToken(accessToken)))
      .returning({ id: authSession.id })
    if (deleted) return
  }

  const refreshToken = readRefreshCookie(c)
  if (refreshToken) {
    const tokenHash = await hashSessionToken(refreshToken)
    const [row] = await db
      .select({ sessionId: authRefreshToken.session_id })
      .from(authRefreshToken)
      .where(eq(authRefreshToken.token_hash, tokenHash))
      .limit(1)
    if (row) {
      await db.delete(authSession).where(eq(authSession.id, row.sessionId))
      return
    }
  }
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(authSession).where(eq(authSession.user_id, userId))
}

export const requireAnySession = createMiddleware<{
  Variables: { viewerId: string; session: SessionData }
}>(async (c, next) => {
  const session = await getSession(c)
  if (!session) return unauthorized(c)
  c.set("viewerId", session.user.id)
  c.set("session", session)
  await next()
})

export const requireSession = createMiddleware<{
  Variables: { viewerId: string; session: SessionData }
}>(async (c, next) => {
  const session = await getSession(c)
  if (!session) return unauthorized(c)
  if (session.user.status !== "active") return forbidden(c)
  c.set("viewerId", session.user.id)
  c.set("session", session)
  await next()
})

export const requireAdmin = createMiddleware<{
  Variables: { adminUserId: string; session: SessionData }
}>(async (c, next) => {
  const session = await getSession(c)
  if (!session) return unauthorized(c)
  if (session.user.status !== "active") return forbidden(c)
  if (session.user.role !== "admin") return forbidden(c)
  c.set("adminUserId", session.user.id)
  c.set("session", session)
  await next()
})
