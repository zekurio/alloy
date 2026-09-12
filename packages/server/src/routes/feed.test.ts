import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import type { FeedPage } from "@alloy/contracts"
import { authSession, user } from "@alloy/db/auth-schema"
import { clip, clipView, game } from "@alloy/db/schema"
import { eq, inArray } from "drizzle-orm"
import { test } from "vite-plus/test"

// Run against a migrated, disposable PostgreSQL database.
test.skipIf(!process.env.ALLOY_TEST_DATABASE_URL)(
  "qualified views personalize recommendations without social data",
  async () => {
    process.env.NODE_ENV = "production"
    process.env.DATABASE_URL = process.env.ALLOY_TEST_DATABASE_URL
    process.env.PUBLIC_SERVER_URL = "https://alloy.example"
    process.env.ALLOY_VIEWER_COOKIE_SECRET = "v".repeat(32)
    process.env.ALLOY_UPLOAD_HMAC_SECRET = "u".repeat(32)

    const { db, client } = await import("@alloy/server/db/index")
    const { hashSessionToken } = await import("@alloy/server/auth/tokens")
    const { deleteUserAccount } =
      await import("@alloy/server/users/account-deletion")
    const { feedRoute } = await import("./feed")
    const { clips } = await import("./clips")
    const viewerId = randomUUID()
    const authorId = randomUUID()
    const otherAuthorId = randomUUID()
    const disabledAuthorId = randomUUID()
    const gameId = randomUUID()
    const otherGameId = randomUUID()
    const watchedId = randomUUID()
    const authorMatchId = randomUUID()
    const gameMatchId = randomUUID()
    const unrelatedId = randomUUID()
    const privateId = randomUUID()
    const unlistedId = randomUUID()
    const pendingId = randomUUID()
    const disabledId = randomUUID()
    const token = randomUUID()
    const headers = { Cookie: `alloy_access=${token}` }
    const publishedAt = new Date(Date.now() - 3_600_000)

    async function feed(
      params: Record<string, string>,
      signedIn = true,
    ): Promise<FeedPage> {
      const response = await feedRoute.request(
        `/?${new URLSearchParams({ sort: "recommended", ...params })}`,
        { headers: signedIn ? headers : {} },
      )
      assert.equal(response.status, 200)
      return response.json()
    }
    const view = (id: string, cookie = headers.Cookie) =>
      clips.request(`/${id}/view`, {
        method: "POST",
        headers: { Cookie: cookie },
      })

    try {
      await db.insert(user).values([
        { id: viewerId, username: `viewer-${viewerId}` },
        { id: authorId, username: `author-${authorId}` },
        { id: otherAuthorId, username: `other-${otherAuthorId}` },
        {
          id: disabledAuthorId,
          username: `disabled-${disabledAuthorId}`,
          disabled_at: new Date(),
        },
      ])
      await db.insert(authSession).values({
        user_id: viewerId,
        token_hash: await hashSessionToken(token),
        expires_at: new Date(Date.now() + 60_000),
      })
      await db.insert(game).values([
        { id: gameId, source: "custom", name: "Watched game", slug: gameId },
        {
          id: otherGameId,
          source: "custom",
          name: "Other game",
          slug: otherGameId,
        },
      ])
      const base = {
        author_id: authorId,
        game_id: gameId,
        title: "Test clip",
        status: "ready" as const,
        privacy: "public" as const,
        published_at: publishedAt,
      }
      await db.insert(clip).values([
        { ...base, id: watchedId },
        { ...base, id: authorMatchId, game_id: otherGameId },
        { ...base, id: gameMatchId, author_id: otherAuthorId },
        {
          ...base,
          id: unrelatedId,
          author_id: otherAuthorId,
          game_id: otherGameId,
        },
        { ...base, id: privateId, privacy: "private", view_count: 1000 },
        { ...base, id: unlistedId, privacy: "unlisted", view_count: 1000 },
        { ...base, id: pendingId, status: "pending", view_count: 1000 },
        {
          ...base,
          id: disabledId,
          author_id: disabledAuthorId,
          view_count: 1000,
        },
      ])
      const responses = await Promise.all([view(watchedId), view(watchedId)])
      assert.deepEqual(
        responses.map((response) => response.status),
        [204, 204],
      )
      const [watched] = await db
        .select()
        .from(clip)
        .where(eq(clip.id, watchedId))
      assert.equal(watched?.view_count, 1)
      assert.equal(
        (await db.select().from(clipView).where(eq(clipView.user_id, viewerId)))
          .length,
        1,
      )
      assert.equal((await view(privateId)).status, 404)
      assert.equal((await view(pendingId)).status, 404)

      const personalized = await feed({ excludeClipId: watchedId })
      assert.deepEqual(
        personalized.items.map((row) => row.id),
        [authorMatchId, gameMatchId, unrelatedId],
      )
      assert.ok(
        personalized.items.every(
          (row) => !("likeCount" in row) && !("commentCount" in row),
        ),
      )
      const first = await feed({ limit: "1", excludeClipId: watchedId })
      assert.ok(first.nextCursor)
      const next = await feed({
        limit: "2",
        excludeClipId: watchedId,
        cursor: first.nextCursor,
      })
      assert.deepEqual(
        [...first.items, ...next.items].map((row) => row.id),
        personalized.items.map((row) => row.id),
      )
      assert.equal(next.nextCursor, null)
      assert.equal((await feed({}, false)).items[0]?.id, watchedId)
      assert.equal((await feed({ sort: "top" }, false)).items[0]?.id, watchedId)

      const anonymous = await view(unrelatedId, "")
      assert.equal(anonymous.status, 204)
      const cookie = anonymous.headers.get("set-cookie")?.split(";")[0]
      assert.ok(cookie)
      assert.equal((await view(unrelatedId, cookie)).status, 204)
      const [unrelated] = await db
        .select()
        .from(clip)
        .where(eq(clip.id, unrelatedId))
      assert.equal(unrelated?.view_count, 1)
      assert.equal((await feedRoute.request("/?filter=following")).status, 400)
      for (const path of ["like", "comments"]) {
        assert.equal(
          (
            await clips.request(`/${watchedId}/${path}`, {
              method: "POST",
              headers,
            })
          ).status,
          404,
        )
      }

      assert.equal(await deleteUserAccount(viewerId, "self"), "deleted")
      const remainingViews = await db
        .select()
        .from(clipView)
        .where(eq(clipView.clip_id, watchedId))
      assert.equal(remainingViews.length, 1)
      assert.equal(remainingViews[0]?.user_id, null)
      assert.ok(remainingViews[0]?.viewer_key.startsWith("deleted:"))
    } finally {
      await db
        .delete(user)
        .where(
          inArray(user.id, [
            viewerId,
            authorId,
            otherAuthorId,
            disabledAuthorId,
          ]),
        )
      await db.delete(game).where(inArray(game.id, [gameId, otherGameId]))
      await client.end()
    }
  },
)
