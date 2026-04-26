import { zValidator } from "@hono/zod-validator"
import { and, eq, or } from "drizzle-orm"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { z } from "zod"

import { authSession, user } from "@workspace/db/auth-schema"
import { block, clip, follow } from "@workspace/db/schema"

import { db } from "../db"
import { getSession } from "../lib/auth/session"
import { deleteClipRowAndAssets } from "../lib/clip-delete"
import {
  contentDisposition,
  downloadFilename,
  nodeToWeb,
} from "./clips-helpers"
import { createZipStream } from "../lib/zip-stream"
import { syncLinkedOAuthImage } from "../lib/oauth-profile-sync"
import { createNotification } from "../lib/notifications"
import { requireSession } from "../lib/require-session"
import { selectSourceStorageUsedBytes } from "../lib/storage-quota"
import { storage } from "../storage"
import {
  SearchQuery,
  UsernameParam,
  listFollowers,
  listFollowing,
  listLikedClips,
  listTaggedClips,
  listUserClips,
  resolveTarget,
  resolveViewerState,
  searchVisibleUsers,
  selectProfileCounts,
  toPublicUser,
} from "./users-helpers"

const ClipBatchQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(100),
})

export const usersRoute = new Hono()
  .get("/search", zValidator("query", SearchQuery), async (c) => {
    const { q, limit } = c.req.valid("query")
    const session = await getSession(c)
    const rows = await searchVisibleUsers({
      q,
      limit,
      viewerId: session?.user.id ?? null,
    })
    return c.json(rows)
  })

  .get("/me/account", requireSession, async (c) => {
    const [row] = await db
      .select({ disabledAt: user.disabledAt })
      .from(user)
      .where(eq(user.id, c.var.viewerId))
      .limit(1)
    return c.json({
      disabledAt: row?.disabledAt ? row.disabledAt.toISOString() : null,
    })
  })

  .get("/me/storage", requireSession, async (c) => {
    const viewerId = c.var.viewerId
    const [row, usedBytes] = await Promise.all([
      db
        .select({ quotaBytes: user.storageQuotaBytes })
        .from(user)
        .where(eq(user.id, viewerId))
        .limit(1),
      selectSourceStorageUsedBytes(db, viewerId),
    ])
    return c.json({
      usedBytes,
      quotaBytes: row[0]?.quotaBytes ?? null,
    })
  })

  .post("/me/disable", requireSession, async (c) => {
    const viewerId = c.var.viewerId
    const now = new Date()
    await db
      .update(user)
      .set({ disabledAt: now, status: "disabled", updatedAt: now })
      .where(eq(user.id, viewerId))
    await db.delete(authSession).where(eq(authSession.userId, viewerId))
    return c.json({ disabledAt: now.toISOString() })
  })

  .post("/me/reactivate", requireSession, async (c) => {
    const now = new Date()
    await db
      .update(user)
      .set({ disabledAt: null, status: "active", updatedAt: now })
      .where(eq(user.id, c.var.viewerId))
    return c.json({ disabledAt: null })
  })

  .get("/me/clips/download", requireSession, async (c) => {
    const rows = await db
      .select()
      .from(clip)
      .where(eq(clip.authorId, c.var.viewerId))
      .orderBy(clip.createdAt)

    const entries = rows.map((row) => ({
      filename: downloadFilename(row, "source"),
      stream: async () => {
        const resolved = await storage.resolve(row.storageKey)
        return resolved?.stream() ?? null
      },
    }))

    c.header("Content-Type", "application/zip")
    c.header(
      "Content-Disposition",
      contentDisposition(
        `alloy-clips-${new Date().toISOString().slice(0, 10)}.zip`
      )
    )
    c.header("Cache-Control", "no-store")

    const zip = createZipStream(entries)
    return stream(c, async (s) => {
      s.onAbort(() => {
        zip.destroy()
      })
      await s.pipe(nodeToWeb(zip))
    })
  })

  .delete(
    "/me/clips",
    requireSession,
    zValidator("query", ClipBatchQuery),
    async (c) => {
      const { limit } = c.req.valid("query")
      const rows = await db
        .select()
        .from(clip)
        .where(eq(clip.authorId, c.var.viewerId))
        .orderBy(clip.createdAt)
        .limit(limit)

      for (const row of rows) {
        await deleteClipRowAndAssets(row)
      }

      return c.json({ deleted: rows.length, hasMore: rows.length === limit })
    }
  )

  .post("/me/sync-oauth-profile", requireSession, async (c) => {
    return c.json(await syncLinkedOAuthImage(c.var.viewerId))
  })

  .get("/:username", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const row = await resolveTarget(username)
    if (!row) return c.json({ error: "Not found" }, 404)
    const counts = await selectProfileCounts(row.id, {
      includeRestrictedClips: false,
    })

    return c.json({
      user: toPublicUser(row),
      counts,
    })
  })

  .get("/:username/viewer", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const sessionPromise = getSession(c)
    const row = await resolveTarget(username)
    if (!row) return c.json({ error: "Not found" }, 404)

    const session = await sessionPromise
    if (!session) return c.json({ viewer: null, counts: null })

    const viewerId = session.user.id
    const isAdmin =
      (session.user as { role?: string | null } | undefined)?.role === "admin"
    const isSelf = viewerId === row.id
    const [viewer, counts] = await Promise.all([
      resolveViewerState(viewerId, row.id),
      isSelf || isAdmin
        ? selectProfileCounts(row.id, { includeRestrictedClips: true })
        : Promise.resolve(null),
    ])

    return c.json({
      viewer,
      counts,
    })
  })

  .get("/:username/clips", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const row = await resolveTarget(username)
    if (!row) return c.json({ error: "Not found" }, 404)

    return c.json(await listUserClips(row, c.req.raw.headers))
  })

  .get("/:username/tagged", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const row = await resolveTarget(username)
    if (!row) return c.json({ error: "Not found" }, 404)

    return c.json(await listTaggedClips(row, c.req.raw.headers))
  })

  .get("/:username/liked", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const row = await resolveTarget(username)
    if (!row) return c.json({ error: "Not found" }, 404)

    return c.json(await listLikedClips(row, c.req.raw.headers))
  })

  .get(
    "/:username/followers",
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const row = await resolveTarget(username)
      if (!row) return c.json({ error: "Not found" }, 404)

      return c.json(await listFollowers(row))
    }
  )

  .get(
    "/:username/following",
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const row = await resolveTarget(username)
      if (!row) return c.json({ error: "Not found" }, 404)

      return c.json(await listFollowing(row))
    }
  )

  .post(
    "/:username/follow",
    requireSession,
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const viewerId = c.var.viewerId

      const target = await resolveTarget(username)
      if (!target) return c.json({ error: "Not found" }, 404)
      const targetId = target.id

      if (viewerId === targetId) {
        return c.json({ error: "You can't follow yourself." }, 400)
      }

      const blockRows = await db
        .select({ id: block.id })
        .from(block)
        .where(
          or(
            and(eq(block.blockerId, viewerId), eq(block.blockedId, targetId)),
            and(eq(block.blockerId, targetId), eq(block.blockedId, viewerId))
          )
        )
        .limit(1)
      if (blockRows.length > 0) {
        return c.json({ error: "Can't follow a blocked user." }, 403)
      }

      const inserted = await db
        .insert(follow)
        .values({
          id: crypto.randomUUID(),
          followerId: viewerId,
          followingId: targetId,
        })
        .onConflictDoNothing()
        .returning({ id: follow.id })

      if (inserted.length > 0) {
        void createNotification({
          recipientId: targetId,
          actorId: viewerId,
          type: "new_follower",
        })
      }

      return c.json({ following: true })
    }
  )

  .delete(
    "/:username/follow",
    requireSession,
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const viewerId = c.var.viewerId
      const target = await resolveTarget(username)
      if (!target) return c.json({ error: "Not found" }, 404)

      await db
        .delete(follow)
        .where(
          and(
            eq(follow.followerId, viewerId),
            eq(follow.followingId, target.id)
          )
        )
      return c.json({ following: false })
    }
  )

  .post(
    "/:username/block",
    requireSession,
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const viewerId = c.var.viewerId
      const target = await resolveTarget(username)
      if (!target) return c.json({ error: "Not found" }, 404)
      if (target.id === viewerId) {
        return c.json({ error: "You can't block yourself." }, 400)
      }

      await db
        .insert(block)
        .values({
          id: crypto.randomUUID(),
          blockerId: viewerId,
          blockedId: target.id,
        })
        .onConflictDoNothing()

      await db
        .delete(follow)
        .where(
          or(
            and(
              eq(follow.followerId, viewerId),
              eq(follow.followingId, target.id)
            ),
            and(
              eq(follow.followerId, target.id),
              eq(follow.followingId, viewerId)
            )
          )
        )

      return c.json({ blocked: true })
    }
  )

  .delete(
    "/:username/block",
    requireSession,
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const viewerId = c.var.viewerId
      const target = await resolveTarget(username)
      if (!target) return c.json({ error: "Not found" }, 404)

      await db
        .delete(block)
        .where(
          and(eq(block.blockerId, viewerId), eq(block.blockedId, target.id))
        )
      return c.json({ blocked: false })
    }
  )
