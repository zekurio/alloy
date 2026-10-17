import type { AuthSessionClientKind } from "@alloy/contracts"
import {
  type AuthSession,
  authSession,
  type User,
  user,
} from "@alloy/db/auth-schema"
import { db } from "@alloy/server/db/index"
import { forbidden, unauthorized } from "@alloy/server/runtime/http-response"
import { requestIp } from "@alloy/server/runtime/request-ip"
import { and, eq, gt } from "drizzle-orm"
import type { Context } from "hono"
import { createMiddleware } from "hono/factory"

import { readSessionToken } from "./cookies"
import { generateSessionToken, hashSessionToken } from "./tokens"

// Sessions never rotate: a client keeps one token until it signs out or stops
// using it for this long. Every copy of the cookie stays valid, so a cookie
// write lost to a crash, or a request made outside the browser, cannot end
// the session.
const SESSION_IDLE_TTL_MS = 90 * 24 * 60 * 60 * 1000
// Activity moves the idle deadline at most this often, so ordinary requests
// stay read-only.
const SESSION_TOUCH_MS = 60 * 60 * 1000
const USER_AGENT_MAX_LENGTH = 512

export type SessionData = {
  session: AuthSession
  user: User
}

export type CreatedSession = {
  token: string
  data: SessionData
}

export type SessionClient = {
  kind: AuthSessionClientKind
  deviceName: string | null
}

const WEB_CLIENT: SessionClient = { kind: "web", deviceName: null }

export class InactiveAccountError extends Error {
  constructor() {
    super("Account is not active.")
    this.name = "InactiveAccountError"
  }
}

const requestSessionCache = new WeakMap<Context, Promise<SessionData | null>>()

function idleExpiresAt(now: Date): Date {
  return new Date(now.getTime() + SESSION_IDLE_TTL_MS)
}

async function touchSession(
  row: SessionData,
  now: Date,
  ipAddress: string | null,
): Promise<void> {
  const lastSeenAt = row.session.last_seen_at ?? row.session.updated_at
  if (lastSeenAt.getTime() + SESSION_TOUCH_MS >= now.getTime()) return

  const expiresAt = idleExpiresAt(now)
  await db
    .update(authSession)
    .set({
      last_seen_at: now,
      expires_at: expiresAt,
      ip_address: ipAddress,
      updated_at: now,
    })
    .where(eq(authSession.id, row.session.id))
  row.session.last_seen_at = now
  row.session.expires_at = expiresAt
  row.session.ip_address = ipAddress
  row.session.updated_at = now
}

export async function createSession(
  c: Context,
  userId: string,
  client: SessionClient = WEB_CLIENT,
): Promise<CreatedSession> {
  const token = generateSessionToken()
  const tokenHash = await hashSessionToken(token)
  const now = new Date()
  const data = await db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
      .for("update")
    if (!account || account.status !== "active") {
      throw new InactiveAccountError()
    }

    const [session] = await tx
      .insert(authSession)
      .values({
        token_hash: tokenHash,
        user_id: userId,
        expires_at: idleExpiresAt(now),
        ip_address: requestIp(c),
        user_agent:
          c.req.header("user-agent")?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
        client_kind: client.kind,
        device_name: client.deviceName,
        last_seen_at: now,
      })
      .returning()
    if (!session) throw new Error("Could not create session.")
    return { session, user: account }
  })

  return { token, data }
}

async function selectSessionByTokenHash(
  tokenHash: string,
  ipAddress: string | null,
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
      ),
    )
    .limit(1)
  if (!row) return null
  await touchSession(row, now, ipAddress)
  return row
}

async function resolveSession(c: Context): Promise<SessionData | null> {
  const token = readSessionToken(c)
  if (!token) return null
  return await selectSessionByTokenHash(
    await hashSessionToken(token),
    requestIp(c),
  )
}

export async function getSession(c: Context): Promise<SessionData | null> {
  const cached = requestSessionCache.get(c)
  if (cached) return cached

  const session = resolveSession(c)
  requestSessionCache.set(c, session)
  return session
}

export async function deleteCurrentSession(c: Context): Promise<void> {
  const token = readSessionToken(c)
  if (!token) return
  await db
    .delete(authSession)
    .where(eq(authSession.token_hash, await hashSessionToken(token)))
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
