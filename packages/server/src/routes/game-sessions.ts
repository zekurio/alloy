import { gameSession, userDevice } from "@alloy/db/schema"
import { requireSession } from "@alloy/server/auth/require-session"
import { db } from "@alloy/server/db/index"
import { resolvePersistedGameByName } from "@alloy/server/games/lookup"
import { isoDate } from "@alloy/server/runtime/date"
import { badRequest, conflict } from "@alloy/server/runtime/http-response"
import { and, eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { zValidator } from "./validation"

const SessionIdParam = z.object({ id: z.uuid() })

const UpsertGameSessionBody = z.object({
  deviceId: z.uuid(),
  gameName: z.string().trim().min(1).max(200),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).optional(),
})

function serialiseGameSession(row: typeof gameSession.$inferSelect) {
  return {
    id: row.id,
    deviceId: row.deviceId,
    gameName: row.gameName,
    steamgriddbId: row.steamgriddbId,
    startedAt: isoDate(row.startedAt),
    endedAt: row.endedAt ? isoDate(row.endedAt) : null,
  }
}

/**
 * Best-effort resolution of the detected game name to a known game. A play
 * session is valid without one — never fail the upsert over metadata. The game
 * is persisted on resolve so the steamgriddb_id FK holds.
 */
async function resolveSessionGame(
  gameName: string,
  viewerId: string,
): Promise<number | null> {
  const game = await resolvePersistedGameByName(gameName, viewerId)
  return game?.steamgriddbId ?? null
}

export const gameSessionsRoute = new Hono()
  // Idempotent upsert keyed by the client-generated session id: the desktop
  // app re-sends the same session at game end and after crash recovery.
  .put(
    "/:id",
    requireSession,
    zValidator("param", SessionIdParam),
    zValidator("json", UpsertGameSessionBody),
    async (c) => {
      const viewerId = c.var.viewerId
      const { id } = c.req.valid("param")
      const body = c.req.valid("json")

      const [device] = await db
        .select({ id: userDevice.id })
        .from(userDevice)
        .where(
          and(
            eq(userDevice.id, body.deviceId),
            eq(userDevice.userId, viewerId),
          ),
        )
        .limit(1)
      if (!device) return badRequest(c, "Unknown device")

      const [existing] = await db
        .select({
          userId: gameSession.userId,
          steamgriddbId: gameSession.steamgriddbId,
        })
        .from(gameSession)
        .where(eq(gameSession.id, id))
        .limit(1)
      if (existing && existing.userId !== viewerId) {
        return conflict(c, "Session id belongs to another user")
      }

      const steamgriddbId =
        existing?.steamgriddbId ??
        (await resolveSessionGame(body.gameName, viewerId))

      const endedAt = body.endedAt ? new Date(body.endedAt) : null
      const [row] = await db
        .insert(gameSession)
        .values({
          id,
          userId: viewerId,
          deviceId: body.deviceId,
          gameName: body.gameName,
          steamgriddbId,
          startedAt: new Date(body.startedAt),
          endedAt,
        })
        .onConflictDoUpdate({
          target: gameSession.id,
          set: {
            gameName: body.gameName,
            steamgriddbId,
            // A re-sent start-only upsert must not clear a recorded end.
            ...(endedAt ? { endedAt } : {}),
            updatedAt: new Date(),
          },
          setWhere: sql`${gameSession.userId} = ${viewerId}`,
        })
        .returning()
      if (!row) {
        return conflict(c, "Session id belongs to another user")
      }
      return c.json({ session: serialiseGameSession(row) })
    },
  )
