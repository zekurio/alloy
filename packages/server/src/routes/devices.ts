import { userDevice } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { db } from "@alloy/server/db/index"
import { isoDate } from "@alloy/server/runtime/date"
import { conflict } from "@alloy/server/runtime/http-response"
import { desc, eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { zValidator } from "./validation"

const DeviceIdParam = z.object({ id: z.uuid() })

const RegisterDeviceBody = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(32),
})

function serialiseDevice(row: typeof userDevice.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    lastSeenAt: isoDate(row.lastSeenAt),
    createdAt: isoDate(row.createdAt),
  }
}

export const devicesRoute = new Hono()
  // Idempotent registration: the desktop app generates its id once and
  // re-PUTs it on every startup to refresh name/platform/lastSeenAt.
  .put(
    "/:id",
    requireSession,
    zValidator("param", DeviceIdParam),
    zValidator("json", RegisterDeviceBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const [row] = await db
        .insert(userDevice)
        .values({
          id,
          userId: viewerId,
          name: body.name,
          platform: body.platform,
        })
        .onConflictDoUpdate({
          target: userDevice.id,
          set: {
            name: body.name,
            platform: body.platform,
            lastSeenAt: new Date(),
          },
          // Never adopt an id that collided with another user's device; the
          // empty update surfaces below as a 409 and the client regenerates.
          setWhere: sql`${userDevice.userId} = ${viewerId}`,
        })
        .returning()
      if (!row) {
        return conflict(c, "Device id is registered to another user")
      }
      return c.json({ device: serialiseDevice(row) })
    },
  )
  .get("/", requireSession, async (c) => {
    const rows = await db
      .select()
      .from(userDevice)
      .where(eq(userDevice.userId, c.var.viewerId))
      .orderBy(desc(userDevice.lastSeenAt))
    return c.json({ devices: rows.map(serialiseDevice) })
  })
