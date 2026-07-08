import { requireSession } from "@alloy/server/auth/require-session"
import {
  InvalidNotificationCursorError,
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
} from "@alloy/server/notifications/service"
import { badRequest, success } from "@alloy/server/runtime/http-response"
import { Hono } from "hono"
import { z } from "zod"

import { limitQueryParam, zValidator } from "./validation"

const ListQuery = z.object({
  cursor: z.string().optional(),
  limit: limitQueryParam(100, 30),
})

const IdParam = z.object({ id: z.uuid() })

export const notificationsRoute = new Hono()
  .get("/", requireSession, zValidator("query", ListQuery), async (c) => {
    try {
      return c.json(
        await listNotifications(c.var.viewerId, c.req.valid("query")),
      )
    } catch (err) {
      if (err instanceof InvalidNotificationCursorError) {
        return badRequest(c, "Invalid cursor")
      }
      throw err
    }
  })
  .get("/unread-count", requireSession, async (c) => {
    return c.json({ count: await countUnread(c.var.viewerId) })
  })
  .post("/read-all", requireSession, async (c) => {
    await markAllRead(c.var.viewerId)
    return success(c)
  })
  .post(
    "/:id/read",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      await markRead(c.var.viewerId, c.req.valid("param").id)
      return success(c)
    },
  )
