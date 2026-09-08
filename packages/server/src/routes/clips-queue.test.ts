import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import { authSession, user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { eq, inArray } from "drizzle-orm"
import { test } from "vite-plus/test"

// Point ALLOY_TEST_DATABASE_URL at a migrated, disposable PostgreSQL database.
test.skipIf(!process.env.ALLOY_TEST_DATABASE_URL)(
  "queue dismissal persists for the owner across snapshots and media work",
  async () => {
    process.env.NODE_ENV = "production"
    process.env.DATABASE_URL = process.env.ALLOY_TEST_DATABASE_URL
    process.env.PUBLIC_SERVER_URL = "https://alloy.example"
    process.env.ALLOY_VIEWER_COOKIE_SECRET = "v".repeat(32)
    process.env.ALLOY_UPLOAD_HMAC_SECRET = "u".repeat(32)

    const { db, client } = await import("@alloy/server/db/index")
    const { clips } = await import("./clips")
    const { hashSessionToken } = await import("@alloy/server/auth/tokens")
    const { selectQueueRowsForAuthor } =
      await import("@alloy/server/clips/queue-select")
    const { publishClipUpsert, subscribeToAuthorQueue } =
      await import("@alloy/server/clips/events")
    const authorId = randomUUID()
    const adminId = randomUUID()
    const clipId = randomUUID()
    const failedId = randomUUID()
    const token = randomUUID()
    const adminToken = randomUUID()
    const events: string[] = []
    const unsubscribe = subscribeToAuthorQueue(authorId, (event) =>
      events.push(event.type),
    )
    const dismiss = (id: string, accessToken?: string) =>
      clips.request(`/${id}/queue-dismissal`, {
        method: "POST",
        headers: accessToken ? { Cookie: `alloy_access=${accessToken}` } : {},
      })

    try {
      await db.insert(user).values([
        { id: authorId, username: `queue-${authorId}` },
        { id: adminId, username: `queue-${adminId}`, role: "admin" },
      ])
      await db.insert(authSession).values([
        {
          user_id: authorId,
          token_hash: await hashSessionToken(token),
          expires_at: new Date(Date.now() + 60_000),
        },
        {
          user_id: adminId,
          token_hash: await hashSessionToken(adminToken),
          expires_at: new Date(Date.now() + 60_000),
        },
      ])
      await db.insert(clip).values([
        {
          id: clipId,
          author_id: authorId,
          title: "Keep my clip",
          status: "ready",
          encode_progress: 100,
        },
        {
          id: failedId,
          author_id: authorId,
          title: "Failed upload",
          status: "failed",
        },
      ])
      assert.equal((await dismiss(clipId)).status, 401)
      assert.equal((await dismiss("invalid", token)).status, 400)
      assert.equal((await dismiss(clipId, adminToken)).status, 404)
      assert.equal((await dismiss(randomUUID(), token)).status, 404)
      assert.equal((await selectQueueRowsForAuthor(authorId)).length, 2)

      assert.equal((await dismiss(clipId, token)).status, 200)
      assert.deepEqual(events, ["remove"])
      assert.deepEqual(
        (await selectQueueRowsForAuthor(authorId)).map((row) => row.id),
        [failedId],
      )
      // Repeating the request and later metadata updates must not revive it.
      assert.equal((await dismiss(clipId, token)).status, 200)
      await publishClipUpsert(authorId, clipId)
      assert.equal(events.at(-1), "remove")
      assert.equal((await dismiss(failedId, token)).status, 200)
      assert.deepEqual(await selectQueueRowsForAuthor(authorId), [])

      await db
        .update(clip)
        .set({ encode_request_id: randomUUID() })
        .where(eq(clip.id, clipId))
      await publishClipUpsert(authorId, clipId)
      assert.equal(events.at(-1), "upsert")
      assert.deepEqual(
        (await selectQueueRowsForAuthor(authorId)).map((row) => row.id),
        [clipId],
      )
      // A dismissal racing with new work still leaves that work visible.
      assert.equal((await dismiss(clipId, token)).status, 200)
      assert.equal(events.at(-1), "upsert")
      await db
        .update(clip)
        .set({ encode_request_id: null })
        .where(eq(clip.id, clipId))
      await publishClipUpsert(authorId, clipId)
      assert.equal(events.at(-1), "remove")
      assert.deepEqual(await selectQueueRowsForAuthor(authorId), [])

      for (const status of ["pending", "processing"] as const) {
        await db.update(clip).set({ status }).where(eq(clip.id, failedId))
        assert.deepEqual(
          (await selectQueueRowsForAuthor(authorId)).map((row) => row.id),
          [failedId],
        )
      }
      const response = await clips.request(`/${clipId}`)
      assert.equal(response.status, 200)
      assert.equal((await response.json()).title, "Keep my clip")
    } finally {
      unsubscribe()
      await db.delete(user).where(inArray(user.id, [authorId, adminId]))
      await client.end()
    }
  },
)
