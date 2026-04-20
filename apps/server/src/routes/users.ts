import { zValidator } from "@hono/zod-validator"
import { and, count, desc, eq, or } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { getAuth } from "../auth"
import { block, clip, follow, game, user } from "@workspace/db/schema"

import { db } from "../db"
import { clipSelectShape } from "../lib/clip-select"
import { requireSession } from "../lib/require-session"

/**
 * Public-ish user endpoints. These back the profile pages: reading any user's
 * public card (name, avatar, clip count, follower/following counts) and
 * managing the viewer's own follow/block edges to them.
 *
 * Design choices worth calling out:
 *   - Profile reads are unauthenticated so a signed-out visitor can still
 *     browse public profiles. The `viewer` block (isFollowing / isBlocked /
 *     isSelf) only populates once a session resolves.
 *   - Blocks take priority over follows: when A blocks B we drop any existing
 *     follow in either direction. That's policy, not a DB constraint, so the
 *     rule lives here where it's grep-able.
 *   - Self-edges are rejected (can't follow or block yourself) so the UI
 *     doesn't need to guard those states.
 *   - The `:username` segment is strictly a handle — `user.username` is
 *     `notNull` and unique, so every user has one and raw ids never appear in
 *     these URLs.
 */

const UsernameParam = z.object({ username: z.string().min(1) })

type UserRow = typeof user.$inferSelect

/**
 * Public projection of a user — everything the profile card renders. We
 * deliberately omit admin/ban fields so this route can't leak moderation
 * state to other users. If a user is banned we still return their row; a
 * viewer policy around ban visibility belongs elsewhere.
 */
interface PublicUser {
  id: string
  username: string
  image: string | null
  createdAt: string
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    image: row.image,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Resolve the `:username` path segment to a full user row via the unique
 * `user.username` index. Returns `null` when no row matches.
 */
async function resolveTarget(segment: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(user)
    .where(eq(user.username, segment))
    .limit(1)
  return row ?? null
}

export const usersRoute = new Hono()
  /**
   * GET /api/users/:username — full profile payload (user row + counts +
   * viewer relationship). Unauthenticated; the `viewer` block is null for
   * signed-out requests.
   */
  .get("/:username", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const row = await resolveTarget(username)
    if (!row) return c.json({ error: "Not found" }, 404)
    const targetId = row.id

    // Pull the three aggregates in parallel — they're independent reads and
    // the profile card always needs all three.
    const [
      [{ value: clipCount }],
      [{ value: followerCount }],
      [{ value: followingCount }],
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(clip)
        .where(eq(clip.authorId, targetId)),
      db
        .select({ value: count() })
        .from(follow)
        .where(eq(follow.followingId, targetId)),
      db
        .select({ value: count() })
        .from(follow)
        .where(eq(follow.followerId, targetId)),
    ])

    // Viewer-relative fields. Peeking at the session here (rather than
    // requiring a session) keeps profile pages visible to signed-out
    // visitors while still letting signed-in viewers see their own edges.
    const session = await getAuth().api.getSession({
      headers: c.req.raw.headers,
    })
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
          // One query for both directions of the block edge — we need both
          // to decide whether the viewer can follow (isBlockedBy hides the
          // follow button) and whether to show the "Blocked" badge.
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

  /**
   * GET /api/users/:username/avatar — CORS-friendly proxy for the stored
   * avatar URL. OAuth providers (Discord/Google/GitHub) don't send
   * `Access-Control-Allow-Origin` on their CDN images, which taints any
   * client-side canvas that draws them. Re-emitting the bytes through our
   * own origin lets the profile page's banner sample pixel colors from the
   * avatar. A short cache header keeps the hot path cheap.
   */
  .get("/:username/avatar", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const row = await resolveTarget(username)
    if (!row || !row.image) return c.json({ error: "Not found" }, 404)

    const upstream = await fetch(row.image)
    if (!upstream.ok || !upstream.body) {
      return c.json({ error: "Upstream avatar unavailable" }, 502)
    }

    // Stream the body straight through — we don't need to buffer the whole
    // image in memory. The global CORS middleware adds the ACAO header.
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/*",
        "cache-control": "public, max-age=3600",
      },
    })
  })

  /**
   * GET /api/users/:username/clips — the clips grid on the profile page.
   * Newest first; capped at 50 to match the home feed limit. Shape mirrors
   * the home-feed `/api/clips` response (including joined author handle /
   * image) so both surfaces can share a single client-side mapper.
   */
  .get("/:username/clips", zValidator("param", UsernameParam), async (c) => {
    const { username } = c.req.valid("param")
    const row = await resolveTarget(username)
    if (!row) return c.json({ error: "Not found" }, 404)
    const rows = await db
      .select(clipSelectShape)
      .from(clip)
      .innerJoin(user, eq(clip.authorId, user.id))
      .leftJoin(game, eq(clip.gameId, game.id))
      .where(eq(clip.authorId, row.id))
      .orderBy(desc(clip.createdAt))
      .limit(50)
    return c.json(rows)
  })

  /**
   * POST /api/users/:username/follow — viewer follows :username. Idempotent:
   * duplicate calls return the existing edge. Rejects self-follow and
   * refuses when either party has blocked the other.
   */
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

      // Either direction of a block torpedoes the follow — the blocker
      // shouldn't leak updates to the blocked user, and the blocked user
      // shouldn't be able to re-establish a relationship the blocker severed.
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

      // `onConflictDoNothing` keeps this endpoint idempotent — the unique
      // index on (follower, following) guarantees at most one row per pair.
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

  /**
   * DELETE /api/users/:username/follow — viewer unfollows :username.
   * Idempotent.
   */
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

  /**
   * POST /api/users/:username/block — viewer blocks :username. Idempotent;
   * also drops any existing follow edge in either direction so we don't
   * leave a zombie subscription behind.
   */
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

      // Sever follows in both directions. Do this after the block insert so
      // the viewer's UI flips to "Blocked" even if the follow delete races.
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

  /**
   * DELETE /api/users/:username/block — viewer unblocks :username. The
   * blocked user doesn't automatically get re-followed; they have to hit
   * follow again.
   */
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
