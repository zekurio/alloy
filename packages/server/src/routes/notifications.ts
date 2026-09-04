import { t } from "@alloy/contracts/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import {
  InvalidNotificationCursorError,
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
  removeNotification,
} from "@alloy/server/notifications/service"
import { badRequest, success } from "@alloy/server/runtime/http-response"
import { Hono } from "hono"

import { limitQueryParam, tbValidator } from "./validation"

const ListQuery = t.object({
  cursor: t.string().optional(),
  limit: limitQueryParam(100, 30),
})

const IdParam = t.object({ id: t.uuid() })

export const notificationsRoute = new Hono()
  .get("/", requireSession, tbValidator("query", ListQuery), async (c) => {
    try {
      return c.json(
        await listNotifications(
          { id: c.var.viewerId, role: c.var.session.user.role },
          c.req.valid("query"),
        ),
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
    tbValidator("param", IdParam),
    async (c) => {
      await markRead(c.var.viewerId, c.req.valid("param").id)
      return success(c)
    },
  )
  .delete("/:id", requireSession, tbValidator("param", IdParam), async (c) => {
    await removeNotification(c.var.viewerId, c.req.valid("param").id)
    return success(c)
  })
