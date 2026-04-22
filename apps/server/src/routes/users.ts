import { zValidator } from "@hono/zod-validator"
import {
  and,
  count,
  eq,
  ilike,
  inArray,
  ne,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm"
import { Hono } from "hono"

import { getAuth } from "../auth"
import { user } from "@workspace/db/auth-schema"
import { block, clip, follow } from "@workspace/db/schema"

import { db } from "../db"
import { syncLinkedOAuthImage } from "../lib/oauth-profile-sync"
import { requireSession } from "../lib/require-session"
import {
  SearchQuery,
  UsernameParam,
  listFollowers,
  listFollowing,
  listTaggedClips,
  listUserClips,
  resolveTarget,
  toLikePattern,
  toPublicUser,
} from "./users-helpers"

export const usersRoute = new Hono()
  .get("/search", zValidator("query", SearchQuery), async (c) => {
    const { q, limit } = c.req.valid("query")
    const pattern = toLikePattern(q.trim())

    const session = await getAuth().api.getSession({
      headers: c.req.raw.headers,
    })
    const viewerId = session?.user.id ?? null

    const conditions: SQL[] = [
      or(
        ilike(user.name, pattern),
        ilike(user.displayUsername, pattern),
        ilike(user.username, pattern)
      )!,
    ]
    if (viewerId) {
      conditions.push(ne(user.id, viewerId))
      const blockRows = await db
        .select({
          blockerId: block.blockerId,
          blockedId: block.blockedId,
        })
        .from(block)
        .where(or(eq(block.blockerId, viewerId), eq(block.blockedId, viewerId)))
      const excluded = new Set<string>()
      for (const row of blockRows) {
        excluded.add(row.blockerId === viewerId ? row.blockedId : row.blockerId)
      }
      if (excluded.size > 0) {
        conditions.push(notInArray(user.id, [...excluded]))
      }
    }

    const rows = await db
      .select({
        id: user.id,
        username: user.username,
        displayUsername: user.displayUsername,
        name: user.name,
        image: user.image,
      })
      .from(user)
      .where(and(...conditions))
      .orderBy(user.username)
      .limit(limit)
    return c.json(rows)
  })

  .post("/me/sync-oauth-profile", requireSession, async (c) => {
    return c.json(await syncLinkedOAuthImage(c.var.viewerId))
  })

  .get("/:username", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const row = await resolveTarget(username)
    if (!row) return c.json({ error: "Not found" }, 404)
    const targetId = row.id

    const session = await getAuth().api.getSession({
      headers: c.req.raw.headers,
    })
    const isOwner = session?.user.id === targetId
    const isAdmin =
      (session?.user as { role?: string | null } | undefined)?.role === "admin"

    const clipConditions: SQL[] = [
      eq(clip.authorId, targetId),
      eq(clip.status, "ready"),
    ]
    if (!isOwner && !isAdmin) {
      clipConditions.push(inArray(clip.privacy, ["public", "unlisted"]))
    }

    const [
      [{ value: clipCount }],
      [{ value: followerCount }],
      [{ value: followingCount }],
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(clip)
        .where(and(...clipConditions)),
      db
        .select({ value: count() })
        .from(follow)
        .where(eq(follow.followingId, targetId)),
      db
        .select({ value: count() })
        .from(follow)
        .where(eq(follow.followerId, targetId)),
    ])

    let viewer: {
      isSelf: boolean
      isFollowing: boolean
      isBlocked: boolean
      isBlockedBy: boolean
    } | null = null

    if (session) {
      const viewerId = session.user.id
      const isSelf = viewerId === targetId
      if (isSelf) {
        viewer = {
          isSelf: true,
          isFollowing: false,
          isBlocked: false,
          isBlockedBy: false,
        }
      } else {
        const [followRow, blockRows] = await Promise.all([
          db
            .select({ id: follow.id })
            .from(follow)
            .where(
              and(
                eq(follow.followerId, viewerId),
                eq(follow.followingId, targetId)
              )
            )
            .limit(1),
          db
            .select({
              blockerId: block.blockerId,
              blockedId: block.blockedId,
            })
            .from(block)
            .where(
              or(
                and(
                  eq(block.blockerId, viewerId),
                  eq(block.blockedId, targetId)
                ),
                and(
                  eq(block.blockerId, targetId),
                  eq(block.blockedId, viewerId)
                )
              )
            ),
        ])

        viewer = {
          isSelf: false,
          isFollowing: followRow.length > 0,
          isBlocked: blockRows.some((b) => b.blockerId === viewerId),
          isBlockedBy: blockRows.some((b) => b.blockerId === targetId),
        }
      }
    }

    return c.json({
      user: toPublicUser(row),
      counts: {
        clips: clipCount,
        followers: followerCount,
        following: followingCount,
      },
      viewer,
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

      await db
        .insert(follow)
        .values({
          id: crypto.randomUUID(),
          followerId: viewerId,
          followingId: targetId,
        })
        .onConflictDoNothing()

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
      const targetId = target.id

      if (viewerId === targetId) {
        return c.json({ error: "You can't block yourself." }, 400)
      }

      await db
        .insert(block)
        .values({
          id: crypto.randomUUID(),
          blockerId: viewerId,
          blockedId: targetId,
        })
        .onConflictDoNothing()

      await db
        .delete(follow)
        .where(
          or(
            and(
              eq(follow.followerId, viewerId),
              eq(follow.followingId, targetId)
            ),
            and(
              eq(follow.followerId, targetId),
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
