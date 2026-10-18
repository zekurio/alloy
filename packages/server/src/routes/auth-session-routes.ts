import { t } from "@alloy/contracts/schema"
import { authSession } from "@alloy/db/auth-schema"
import { publicAuthSessionSummary } from "@alloy/server/auth/security-responses"
import { requireSession } from "@alloy/server/auth/session"
import { db } from "@alloy/server/db/index"
import {
  badRequest,
  notFound,
  success,
} from "@alloy/server/runtime/http-response"
import { and, desc, eq, gt, ne, sql } from "drizzle-orm"
import { Hono } from "hono"

import { tbValidator } from "./validation"

const UuidParam = t.object({
  id: t.string().uuid(),
})

export const authSessionRoutes = new Hono()
  .get("/sessions", requireSession, async (c) => {
    const currentId = c.var.session.session.id
    const rows = await db
      .select()
      .from(authSession)
      .where(
        and(
          eq(authSession.user_id, c.var.viewerId),
          gt(authSession.expires_at, new Date()),
        ),
      )
      .orderBy(
        desc(eq(authSession.id, currentId)),
        desc(
          sql`coalesce(${authSession.last_seen_at}, ${authSession.created_at})`,
        ),
        desc(authSession.created_at),
      )
    return c.json(rows.map((row) => publicAuthSessionSummary(row, currentId)))
  })
  .post("/sessions/revoke-others", requireSession, async (c) => {
    const now = new Date()
    // Expired rows go too, but only live sessions count as revoked.
    const deleted = await db
      .delete(authSession)
      .where(
        and(
          eq(authSession.user_id, c.var.viewerId),
          ne(authSession.id, c.var.session.session.id),
        ),
      )
      .returning({ expiresAt: authSession.expires_at })
    return c.json({
      revoked: deleted.filter((row) => row.expiresAt > now).length,
    })
  })
  .delete(
    "/sessions/:id",
    requireSession,
    tbValidator("param", UuidParam),
    async (c) => {
      const { id } = c.req.valid("param")
      if (id === c.var.session.session.id) {
        return badRequest(c, "Sign out to end the current session.")
      }
      const [deleted] = await db
        .delete(authSession)
        .where(
          and(eq(authSession.id, id), eq(authSession.user_id, c.var.viewerId)),
        )
        .returning({ id: authSession.id })
      if (!deleted) return notFound(c, "Session not found.")
      return success(c)
    },
  )
