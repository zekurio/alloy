import { and, eq, gt, lt } from "drizzle-orm"
import { createMiddleware } from "hono/factory"
import type { Context } from "hono"

import {
  authSession,
  user,
  type AuthSession,
  type User,
} from "@workspace/db/auth-schema"

import { db } from "../../db"
import { readSessionCookie } from "./cookies"
import { generateSessionToken, hashSessionToken } from "./tokens"

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_TOUCH_MS = 60 * 60 * 1000

export type AuthUser = User

export type SessionData = {
  session: AuthSession
  user: AuthUser
}

function requestIp(c: Context): string | null {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    null
  )
}

export async function createSession(
  c: Context,
  userId: string
): Promise<{ token: string; data: SessionData }> {
  const token = generateSessionToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  const [session] = await db
    .insert(authSession)
    .values({
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt,
      ipAddress: requestIp(c),
      userAgent: c.req.header("user-agent") ?? null,
      lastSeenAt: now,
    })
    .returning()
  if (!session) throw new Error("Could not create session.")
  const data = await selectSessionByHash(session.tokenHash)
  if (!data) throw new Error("Could not load session.")
  return { token, data }
}

async function selectSessionByHash(tokenHash: string): Promise<SessionData | null> {
  const now = new Date()
  const [row] = await db
    .select({ session: authSession, user })
    .from(authSession)
    .innerJoin(user, eq(user.id, authSession.userId))
    .where(
      and(
        eq(authSession.tokenHash, tokenHash),
        gt(authSession.expiresAt, now)
      )
    )
    .limit(1)
  if (!row) return null
  const lastSeenAt = row.session.lastSeenAt ?? row.session.updatedAt
  if (lastSeenAt.getTime() + SESSION_TOUCH_MS < now.getTime()) {
    await db
      .update(authSession)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(eq(authSession.id, row.session.id))
    row.session.lastSeenAt = now
    row.session.updatedAt = now
  }
  return row
}

export async function getSession(
  headers: Headers | Context
): Promise<SessionData | null> {
  const token =
    "req" in headers
      ? readSessionCookie(headers)
      : cookieTokenFromHeaders(headers)
  if (!token) return null
  const data = await selectSessionByHash(hashSessionToken(token))
  if (!data) return null
  return data
}

function cookieTokenFromHeaders(headers: Headers): string | null {
  const cookie = headers.get("cookie")
  if (!cookie) return null
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name !== "alloy_session") continue
    try {
      return decodeURIComponent(rest.join("="))
    } catch {
      return null
    }
  }
  return null
}

export async function deleteCurrentSession(c: Context): Promise<void> {
  const token = readSessionCookie(c)
  if (!token) return
  await db.delete(authSession).where(eq(authSession.tokenHash, hashSessionToken(token)))
}

export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await db.delete(authSession).where(eq(authSession.userId, userId))
}

export async function deleteExpiredSessions(): Promise<void> {
  await db.delete(authSession).where(lt(authSession.expiresAt, new Date()))
}

export const requireAnySession = createMiddleware<{
  Variables: { viewerId: string; session: SessionData }
}>(async (c, next) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  c.set("viewerId", session.user.id)
  c.set("session", session)
  await next()
})

export const requireSession = createMiddleware<{
  Variables: { viewerId: string; session: SessionData }
}>(async (c, next) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  if (session.user.status !== "active") return c.json({ error: "Forbidden" }, 403)
  c.set("viewerId", session.user.id)
  c.set("session", session)
  await next()
})

export const requireAdmin = createMiddleware<{
  Variables: { adminUserId: string; session: SessionData }
}>(async (c, next) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  if (session.user.status !== "active") return c.json({ error: "Forbidden" }, 403)
  if (session.user.role !== "admin") return c.json({ error: "Forbidden" }, 403)
  c.set("adminUserId", session.user.id)
  c.set("session", session)
  await next()
})
