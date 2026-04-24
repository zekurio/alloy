import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"

import { requireSession } from "../lib/require-session"
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../lib/notifications"

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
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

  .patch(
    "/:id/read",
    requireSession,
    zValidator("param", IdParam),
    async (c) => {
      const { id } = c.req.valid("param")
      const row = await markNotificationRead(c.var.viewerId, id)
      if (!row) return c.json({ error: "Not found" }, 404)
      return c.json(row)
    }
  )
