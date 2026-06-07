import {
  NOTIFICATIONS_DEFAULT_LIMIT,
  NOTIFICATIONS_MAX_LIMIT,
} from "alloy-contracts"
import { Hono } from "hono"
import { z } from "zod"

import { requireSession } from "../auth/require-session"
import {
  clearNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../notifications"
import { notFound } from "../runtime/http-response"
import { limitQueryParam, zValidator } from "./validation"

const ListQuery = z.object({
  limit: limitQueryParam(NOTIFICATIONS_MAX_LIMIT, NOTIFICATIONS_DEFAULT_LIMIT),
})

const IdParam = z.object({ id: z.uuid() })

export const notificationsRoute = new Hono()
  .get("/", requireSession, zValidator("query", ListQuery), async (c) => {
    const { limit } = c.req.valid("query")
    return c.json(await listNotifications(c.var.viewerId, limit))
  })
  .patch("/read-all", requireSession, async (c) => {
    return c.json(await markAllNotificationsRead(c.var.viewerId))
  })
  .delete("/", requireSession, async (c) => {
    return c.json(await clearNotifications(c.var.viewerId))
  })
  .patch(
    "/:id/read",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const { id } = c.req.valid("param")
      const row = await markNotificationRead(c.var.viewerId, id)
      if (!row) return notFound(c)
      return c.json(row)
    },
  )
  .delete("/:id", requireSession, zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const result = await deleteNotification(c.var.viewerId, id)
    if (!result) return notFound(c)
    return c.json(result)
  })
