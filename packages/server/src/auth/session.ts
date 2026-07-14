import { authRefreshToken, authSession, user } from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import { forbidden, unauthorized } from "@alloy/server/runtime/http-response"
import { requestIp } from "@alloy/server/runtime/request-ip"
import { and, eq, gt, isNull } from "drizzle-orm"
import type { Context } from "hono"
import { createMiddleware } from "hono/factory"

import {
  readAccessCookie,
  readRefreshCookie,
  type SessionCookieTokens,
} from "./cookies"
import {
  accessExpiresAt,
  refreshAbsoluteExpiresAt,
  refreshIdleExpiresAt,
  refreshSession,
  type SessionData,
} from "./session-refresh"
import { generateSessionToken, hashSessionToken } from "./tokens"

export {
  ACCESS_TTL_MS,
  REFRESH_ABSOLUTE_TTL_MS,
  REFRESH_IDLE_TTL_MS,
  refreshSession,
} from "./session-refresh"
const SESSION_TOUCH_MS = 60 * 60 * 1000

type CreatedSession = {
  tokens: SessionCookieTokens
  data: SessionData
}

const requestSessionCache = new WeakMap<Context, Promise<SessionData | null>>()

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

async function resolveSession(
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

export async function getSession(
  headers: Headers | Context,
): Promise<SessionData | null> {
  if (!("req" in headers)) return resolveSession(headers)

  const cached = requestSessionCache.get(headers)
  if (cached) return cached

  const session = resolveSession(headers)
  requestSessionCache.set(headers, session)
  return session
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
