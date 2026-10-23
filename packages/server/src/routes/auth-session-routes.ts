import { publicAuthSessionSummary } from "@alloy/server/auth/security-responses"
import {
  deleteOtherSessions,
  deleteUserSession,
  listUserSessions,
  requireSession,
} from "@alloy/server/auth/session"
import {
  badRequest,
  notFound,
  success,
} from "@alloy/server/runtime/http-response"
import { Hono } from "hono"

import { IdParam, tbValidator } from "./validation"

export const authSessionRoutes = new Hono()
  .get("/sessions", requireSession, async (c) => {
    const currentId = c.var.session.session.id
    const rows = await listUserSessions(c.var.viewerId, currentId)
    return c.json(rows.map((row) => publicAuthSessionSummary(row, currentId)))
  })
  .post("/sessions/revoke-others", requireSession, async (c) => {
    return c.json({
      revoked: await deleteOtherSessions(
        c.var.viewerId,
        c.var.session.session.id,
      ),
    })
  })
  .delete(
    "/sessions/:id",
    requireSession,
    tbValidator("param", IdParam),
    async (c) => {
      const { id } = c.req.valid("param")
      if (id === c.var.session.session.id) {
        return badRequest(c, "Sign out to end the current session.")
      }
      if (!(await deleteUserSession(c.var.viewerId, id))) {
        return notFound(c, "Session not found.")
      }
      return success(c)
    },
  )
