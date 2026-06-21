import { user } from "@alloy/db/auth-schema"
import { block, clip, follow } from "@alloy/db/schema"
import { createZipStream } from "@alloy/server/archive/zip-stream"
import { clearSessionCookies } from "@alloy/server/auth/cookies"
import { assertCanRemoveAdmin } from "@alloy/server/auth/identity"
import { requireSession } from "@alloy/server/auth/require-session"
import {
  deleteAllSessionsForUser,
  getSession,
  requireAnySession,
} from "@alloy/server/auth/session"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { db } from "@alloy/server/db/index"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import {
  accountState,
  batchProgress,
  booleanFlag,
} from "@alloy/server/runtime/http-response"
import { pipeReadable } from "@alloy/server/runtime/streaming"
import { clipStorage } from "@alloy/server/storage/index"
import { selectSourceStorageUsedBytes } from "@alloy/server/storage/quota"
import { and, eq, or } from "drizzle-orm"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { z } from "zod"

import { contentDisposition, downloadFilename } from "./clips-helpers"
import {
  listLikedClips,
  listTaggedClips,
  listUserClips,
  listUserGames,
  UserGamesQuery,
} from "./users-clip-listings"
import {
  listFollowers,
  listFollowing,
  resolveViewerState,
  SearchQuery,
  searchVisibleUsers,
  selectProfileCounts,
  toPublicUser,
  UsernameParam,
} from "./users-helpers"
import {
  deleteViewerBlock,
  resolveRelationshipTarget,
  resolveUserTarget,
} from "./users-relationship"
import { limitQueryParam, zValidator } from "./validation"

const ClipBatchQuery = z.object({
  limit: limitQueryParam(100, 100),
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
    return accountState(c, nullableIsoDate(row?.disabledAt ?? null))
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
    await assertCanRemoveAdmin(viewerId)
    await db
      .update(user)
      .set({ disabledAt: now, status: "disabled", updatedAt: now })
      .where(eq(user.id, viewerId))
    await deleteAllSessionsForUser(viewerId)
    clearSessionCookies(c)
    return accountState(c, isoDate(now))
  })
  .post("/me/reactivate", requireAnySession, async (c) => {
    const now = new Date()
    await db
      .update(user)
      .set({ disabledAt: null, status: "active", updatedAt: now })
      .where(eq(user.id, c.var.viewerId))
    return accountState(c, null)
  })
  .get("/me/clips/download", requireSession, async (c) => {
    const rows = await db
      .select()
      .from(clip)
      .where(eq(clip.authorId, c.var.viewerId))
      .orderBy(clip.createdAt)

    const entries = rows.map((row) => ({
      filename: downloadFilename(row),
      stream: async () => {
        if (!row.sourceKey) return null
        const resolved = await clipStorage.resolve(row.sourceKey)
        return resolved?.stream() ?? null
      },
    }))

    c.header("Content-Type", "application/zip")
    c.header(
      "Content-Disposition",
      contentDisposition(
        `alloy-clips-${new Date().toISOString().slice(0, 10)}.zip`,
      ),
    )
    c.header("Cache-Control", "no-store")

    const zip = createZipStream(entries)
    return stream(c, async (s) => {
      await pipeReadable(s, zip)
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
        .limit(limit + 1)
      const batch = rows.slice(0, limit)

      for (const row of batch) {
        await deleteClipRowAndAssets(row)
      }

      return batchProgress(c, "deleted", batch.length, rows.length > limit)
    },
  )
  .get("/:username", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const result = await resolveUserTarget(c, username)
    if ("response" in result) return result.response
    const row = result.target
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
    const result = await resolveUserTarget(c, username)
    if ("response" in result) return result.response
    const row = result.target

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
    const result = await resolveUserTarget(c, username)
    if ("response" in result) return result.response
    const row = result.target

    return c.json(await listUserClips(row, c))
  })
  .get(
    "/:username/games",
    zValidator("param", UsernameParam),
    zValidator("query", UserGamesQuery),
    async (c) => {
      const { username } = c.req.valid("param")
      const query = c.req.valid("query")
      const result = await resolveUserTarget(c, username)
      if ("response" in result) return result.response
      const row = result.target

      return c.json(await listUserGames(row, c, query))
    },
  )
  .get("/:username/tagged", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const result = await resolveUserTarget(c, username)
    if ("response" in result) return result.response
    const row = result.target

    return c.json(await listTaggedClips(row, c))
  })
  .get("/:username/liked", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const result = await resolveUserTarget(c, username)
    if ("response" in result) return result.response
    const row = result.target

    return c.json(await listLikedClips(row, c))
  })
  .get(
    "/:username/followers",
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const result = await resolveUserTarget(c, username)
      if ("response" in result) return result.response
      const row = result.target

      return c.json(await listFollowers(row))
    },
  )
  .get(
    "/:username/following",
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const result = await resolveUserTarget(c, username)
      if ("response" in result) return result.response
      const row = result.target

      return c.json(await listFollowing(row))
    },
  )
  .post(
    "/:username/follow",
    requireSession,
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const viewerId = c.var.viewerId

      const result = await resolveRelationshipTarget(c, {
        username,
        viewerId,
        selfError: "You can't follow yourself.",
        rejectBlockedRelationship: true,
      })
      if ("response" in result) return result.response
      const target = result.target
      const targetId = target.id

      await db
        .insert(follow)
        .values({
          id: crypto.randomUUID(),
          followerId: viewerId,
          followingId: targetId,
        })
        .onConflictDoNothing()

      return booleanFlag(c, "following", true)
    },
  )
  .delete(
    "/:username/follow",
    requireSession,
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const viewerId = c.var.viewerId
      const result = await resolveRelationshipTarget(c, { username, viewerId })
      if ("response" in result) return result.response
      const target = result.target

      await db
        .delete(follow)
        .where(
          and(
            eq(follow.followerId, viewerId),
            eq(follow.followingId, target.id),
          ),
        )
      return booleanFlag(c, "following", false)
    },
  )
  .post(
    "/:username/block",
    requireSession,
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      const viewerId = c.var.viewerId
      const result = await resolveRelationshipTarget(c, {
        username,
        viewerId,
        selfError: "You can't block yourself.",
      })
      if ("response" in result) return result.response
      const target = result.target

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
              eq(follow.followingId, target.id),
            ),
            and(
              eq(follow.followerId, target.id),
              eq(follow.followingId, viewerId),
            ),
          ),
        )

      return booleanFlag(c, "blocked", true)
    },
  )
  .delete(
    "/:username/block",
    requireSession,
    zValidator("param", UsernameParam),
    async (c) => {
      const { username } = c.req.valid("param")
      return deleteViewerBlock(c, username, c.var.viewerId)
    },
  )
