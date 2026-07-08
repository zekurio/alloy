import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

import {
  parseMentionUsernames,
  type NotificationStreamEvent,
} from "@alloy/contracts"
import { authSession, user } from "@alloy/db/auth-schema"
import {
  clip,
  clipComment,
  clipCommentMention,
  clipMention,
  notification,
} from "@alloy/db/schema"
import { hashSessionToken } from "@alloy/server/auth/tokens"
import { prepareTestDatabase } from "@alloy/server/db/test-database"
import { subscribeToNotifications } from "@alloy/server/notifications/events"
import { eq } from "drizzle-orm"
import { Hono } from "hono"

test("parseMentionUsernames lowercases, dedupes, skips emails, and keeps widened username tokens", () => {
  assert.deepEqual(parseMentionUsernames("hi @alice @Bob a@b.com @alice"), [
    "alice",
    "bob",
  ])
  assert.deepEqual(parseMentionUsernames("ping @john.doe and @user-name"), [
    "john.doe",
    "user-name",
  ])
})

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "notification postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  await prepareTestDatabase("notifications")

  // Dynamic imports are required because these modules import db/index, which
  // reads DATABASE_URL at import time; prepareTestDatabase installs it first.
  const { db, client } = await import("@alloy/server/db/index")
  const { createNotification, createStoredClipMentionNotifications } =
    await import("@alloy/server/notifications/service")
  const { clips } = await import("@alloy/server/routes/clips")
  const { notificationsRoute } =
    await import("@alloy/server/routes/notifications")
  const { getJobKind } = await import("@alloy/server/jobs/registry")
  await import("@alloy/server/jobs/kinds/notification-retention")

  const routeApp = new Hono()
    .route("/api/clips", clips)
    .route("/api/notifications", notificationsRoute)

  after(() => client.end())

  beforeEach(async () => {
    await db.delete(notification)
    await db.delete(clipCommentMention)
    await db.delete(clipComment)
    await db.delete(clipMention)
    await db.delete(clip)
    await db.delete(authSession)
    await db.delete(user)
  })

  test("createNotification skips self notifications", async () => {
    const actor = await insertUser("actor")

    await createNotification({
      recipientId: actor.id,
      actorId: actor.id,
      kind: "follow",
    })

    const rows = await db.select().from(notification)
    assert.equal(rows.length, 0)
  })

  test(
    "createNotification dedups repeated keys while allowing distinct events",
    { timeout: 5_000 },
    async () => {
      const actor = await insertUser("actor")
      const recipient = await insertUser("recipient")
      const events: Array<{ kind: string; id: string }> = []
      const unsubscribe = subscribeToNotifications(recipient.id, (event) => {
        events.push({ kind: event.item.kind, id: event.item.id })
      })

      try {
        await createNotification({
          recipientId: recipient.id,
          actorId: actor.id,
          kind: "follow",
          dedupKey: "follow:actor:first",
        })
        await createNotification({
          recipientId: recipient.id,
          actorId: actor.id,
          kind: "follow",
          dedupKey: "follow:actor:first",
        })
        await createNotification({
          recipientId: recipient.id,
          actorId: actor.id,
          kind: "follow",
          dedupKey: "follow:actor:second",
        })
      } finally {
        unsubscribe()
      }

      const rows = await db
        .select({ kind: notification.kind, dedupKey: notification.dedup_key })
        .from(notification)
        .where(eq(notification.recipient_id, recipient.id))

      assert.deepEqual(
        rows
          .map((row) => ({ kind: row.kind, dedupKey: row.dedupKey }))
          .sort(compareByDedupKey),
        [
          { kind: "follow", dedupKey: "follow:actor:first" },
          { kind: "follow", dedupKey: "follow:actor:second" },
        ],
      )
      assert.equal(events.length, 2)
      assert.deepEqual(
        events.map((event) => event.kind),
        ["follow", "follow"],
      )
    },
  )

  test(
    "comment creation persists mentions and does not duplicate mention notifications for the clip author",
    { timeout: 5_000 },
    async () => {
      const clipAuthor = await insertUser("owner")
      const commenter = await insertUser("commenter")
      const alice = await insertUser("alice")
      const clipId = await insertReadyClip(clipAuthor.id)
      const commenterCookie = await sessionCookieFor(commenter.id)
      const ownerNotification = nextNotificationFor(clipAuthor.id)
      const aliceNotification = nextNotificationFor(alice.id)

      const response = await routeApp.request(`/api/clips/${clipId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: commenterCookie,
        },
        body: JSON.stringify({ body: "hello @alice and @owner" }),
      })

      assert.equal(response.status, 201)
      const created = (await response.json()) as {
        id: string
        mentions: string[]
      }
      assert.deepEqual([...created.mentions].sort(), ["alice", "owner"])

      const [ownerEvent, aliceEvent] = await Promise.all([
        ownerNotification,
        aliceNotification,
      ])
      assert.equal(ownerEvent.item.kind, "clip_comment")
      assert.equal(aliceEvent.item.kind, "comment_mention")

      const mentionRows = await db
        .select({ mentionedUserId: clipCommentMention.mentioned_user_id })
        .from(clipCommentMention)
        .where(eq(clipCommentMention.comment_id, created.id))
      assert.deepEqual(
        mentionRows.map((row) => row.mentionedUserId).sort(),
        [alice.id, clipAuthor.id].sort(),
      )

      const notificationRows = await db
        .select({
          recipientId: notification.recipient_id,
          kind: notification.kind,
        })
        .from(notification)
        .where(eq(notification.comment_id, created.id))

      assert.deepEqual(
        notificationRows
          .map((row) => ({ recipientId: row.recipientId, kind: row.kind }))
          .sort(compareByRecipientAndKind),
        [
          { recipientId: alice.id, kind: "comment_mention" },
          { recipientId: clipAuthor.id, kind: "clip_comment" },
        ].sort(compareByRecipientAndKind),
      )

      const duplicateOwnerMentions = notificationRows.filter(
        (row) =>
          row.recipientId === clipAuthor.id && row.kind === "comment_mention",
      )
      assert.equal(duplicateOwnerMentions.length, 0)
    },
  )

  test(
    "comment edit notifies only newly added mentions",
    { timeout: 5_000 },
    async () => {
      const clipAuthor = await insertUser("owner")
      const commenter = await insertUser("commenter")
      const alice = await insertUser("alice")
      const bob = await insertUser("bob")
      const clipId = await insertReadyClip(clipAuthor.id)
      const commenterCookie = await sessionCookieFor(commenter.id)
      const aliceInitialNotification = nextNotificationFor(alice.id)

      const createResponse = await routeApp.request(
        `/api/clips/${clipId}/comments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: commenterCookie,
          },
          body: JSON.stringify({ body: "hello @alice" }),
        },
      )

      assert.equal(createResponse.status, 201)
      const created = (await createResponse.json()) as {
        id: string
        mentions: string[]
      }
      assert.deepEqual(created.mentions, ["alice"])
      const aliceInitialEvent = await aliceInitialNotification
      assert.equal(aliceInitialEvent.item.kind, "comment_mention")

      const bobNotification = nextNotificationFor(bob.id)
      const editResponse = await routeApp.request(
        `/api/clips/comments/${created.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: commenterCookie,
          },
          body: JSON.stringify({ body: "hello @alice and @bob" }),
        },
      )

      assert.equal(editResponse.status, 200)
      const bobEvent = await bobNotification
      assert.equal(bobEvent.item.kind, "comment_mention")

      const notificationRows = await db
        .select({
          recipientId: notification.recipient_id,
          kind: notification.kind,
        })
        .from(notification)
        .where(eq(notification.comment_id, created.id))
      const mentionRows = notificationRows
        .filter((row) => row.kind === "comment_mention")
        .map((row) => ({ recipientId: row.recipientId, kind: row.kind }))
        .sort(compareByRecipientAndKind)

      assert.deepEqual(
        mentionRows,
        [
          { recipientId: alice.id, kind: "comment_mention" },
          { recipientId: bob.id, kind: "comment_mention" },
        ].sort(compareByRecipientAndKind),
      )
      assert.equal(
        mentionRows.filter((row) => row.recipientId === alice.id).length,
        1,
      )
      assert.equal(
        mentionRows.filter((row) => row.recipientId === bob.id).length,
        1,
      )
    },
  )

  test("notification route rejects invalid cursors", async () => {
    const viewer = await insertUser("viewer")
    const viewerCookie = await sessionCookieFor(viewer.id)

    const validResponse = await routeApp.request("/api/notifications", {
      headers: { Cookie: viewerCookie },
    })
    assert.equal(validResponse.status, 200)

    const invalidResponse = await routeApp.request(
      "/api/notifications?cursor=garbage",
      {
        headers: { Cookie: viewerCookie },
      },
    )
    assert.equal(invalidResponse.status, 400)
  })

  test("stored clip mention fan-out is idempotent", async () => {
    const author = await insertUser("author")
    const alice = await insertUser("alice")
    const bob = await insertUser("bob")
    const clipId = await insertReadyClip(author.id)

    await db.insert(clipMention).values([
      { clip_id: clipId, mentioned_user_id: alice.id },
      { clip_id: clipId, mentioned_user_id: bob.id },
    ])

    await createStoredClipMentionNotifications(clipId)
    await createStoredClipMentionNotifications(clipId)

    const rows = await db
      .select({
        recipientId: notification.recipient_id,
        kind: notification.kind,
        dedupKey: notification.dedup_key,
      })
      .from(notification)
      .where(eq(notification.clip_id, clipId))

    assert.deepEqual(
      rows
        .map((row) => ({
          recipientId: row.recipientId,
          kind: row.kind,
          dedupKey: row.dedupKey,
        }))
        .sort(compareByRecipientAndKind),
      [
        {
          recipientId: alice.id,
          kind: "clip_mention",
          dedupKey: `clip_mention:${clipId}`,
        },
        {
          recipientId: bob.id,
          kind: "clip_mention",
          dedupKey: `clip_mention:${clipId}`,
        },
      ].sort(compareByRecipientAndKind),
    )
  })

  test("notification retention prunes expired unread and old read rows", async () => {
    const actor = await insertUser("actor")
    const recipient = await insertUser("recipient")
    const dayMs = 24 * 60 * 60 * 1000
    const now = Date.now()

    await db.insert(notification).values([
      {
        recipient_id: recipient.id,
        actor_id: actor.id,
        kind: "follow",
        dedup_key: "unread-89",
        created_at: new Date(now - 89 * dayMs),
      },
      {
        recipient_id: recipient.id,
        actor_id: actor.id,
        kind: "follow",
        dedup_key: "unread-91",
        created_at: new Date(now - 91 * dayMs),
      },
      {
        recipient_id: recipient.id,
        actor_id: actor.id,
        kind: "follow",
        dedup_key: "read-29",
        created_at: new Date(now - 29 * dayMs),
        read_at: new Date(now - 29 * dayMs),
      },
      {
        recipient_id: recipient.id,
        actor_id: actor.id,
        kind: "follow",
        dedup_key: "read-31",
        created_at: new Date(now - 31 * dayMs),
        read_at: new Date(now - 31 * dayMs),
      },
    ])

    const prune = getJobKind("notification.prune")
    assert.ok(prune)
    await prune.handler(
      {},
      {
        signal: new AbortController().signal,
        attempt: 1,
        jobId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
        setProgress() {},
      },
    )

    const survivingDedupKeys = await db
      .select({ dedupKey: notification.dedup_key })
      .from(notification)
      .where(eq(notification.recipient_id, recipient.id))

    assert.deepEqual(
      survivingDedupKeys
        .map((row) => row.dedupKey)
        .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
      ["read-29", "unread-89"],
    )
  })

  async function insertUser(username: string): Promise<{ id: string }> {
    const id = crypto.randomUUID()
    await db.insert(user).values({
      id,
      email: `${username}-${id}@example.test`,
      username,
      display_username: username,
    })
    return { id }
  }

  async function insertReadyClip(authorId: string): Promise<string> {
    const id = crypto.randomUUID()
    await db.insert(clip).values({
      id,
      author_id: authorId,
      title: "Mention test clip",
      status: "ready",
    })
    return id
  }

  async function sessionCookieFor(userId: string): Promise<string> {
    const token = crypto.randomUUID()
    await db.insert(authSession).values({
      token_hash: await hashSessionToken(token),
      user_id: userId,
      expires_at: new Date(Date.now() + 60_000),
      last_seen_at: new Date(),
    })
    return `alloy_access=${encodeURIComponent(token)}`
  }

  function nextNotificationFor(
    userId: string,
  ): Promise<NotificationStreamEvent> {
    return new Promise<NotificationStreamEvent>((resolve) => {
      const unsubscribe = subscribeToNotifications(
        userId,
        (notificationEvent) => {
          unsubscribe()
          resolve(notificationEvent)
        },
      )
    })
  }

  function compareByDedupKey(
    a: { dedupKey: string | null },
    b: { dedupKey: string | null },
  ): number {
    return (a.dedupKey ?? "").localeCompare(b.dedupKey ?? "")
  }

  function compareByRecipientAndKind(
    a: { recipientId: string; kind: string },
    b: { recipientId: string; kind: string },
  ): number {
    return (
      a.recipientId.localeCompare(b.recipientId) || a.kind.localeCompare(b.kind)
    )
  }
}
