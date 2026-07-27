import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

import { user } from "@alloy/db/auth-schema"
import { clip, job, webhook, webhookDelivery } from "@alloy/db/schema"
import { client, db } from "@alloy/server/db/index"
import { prepareTestDatabase } from "@alloy/server/db/test-database"

await prepareTestDatabase("webhooks")

const { dispatchClipPublished } = await import("./publish")

after(() => client.end())

beforeEach(async () => {
  await db.delete(job)
  await db.delete(webhookDelivery)
  await db.delete(webhook)
  await db.delete(clip)
  await db.delete(user)
})

test("a published clip claims one ledger row and one job per enabled webhook", async () => {
  const author = await insertUser()
  const first = await insertWebhook("discord")
  const second = await insertWebhook("generic")
  const clipId = await insertClip(author)

  await dispatchClipPublished(clipId)

  const deliveries = await listDeliveries()
  assert.deepEqual(
    deliveries.map((row) => row.webhookId).sort(compareText),
    [first, second].sort(compareText),
  )
  assert.deepEqual(
    deliveries.map((row) => row.dedupKey),
    [`clip.published:${clipId}`, `clip.published:${clipId}`],
  )
  assert.equal(deliveries[0]?.status, "pending")

  const jobs = await db
    .select({ kind: job.kind, dedupKey: job.dedup_key })
    .from(job)
  assert.equal(jobs.length, 2)
  assert.ok(jobs.every((row) => row.kind === "webhook.deliver"))
  // Each job is deduped on its own delivery row, so a redelivery cannot
  // collapse two webhooks into one job.
  assert.deepEqual(
    jobs.map((row) => row.dedupKey).sort(compareText),
    deliveries.map((row) => row.id).sort(compareText),
  )
})

test("re-publishing the same clip announces nothing a second time", async () => {
  const author = await insertUser()
  await insertWebhook("discord")
  const clipId = await insertClip(author)

  await dispatchClipPublished(clipId)
  // Stands in for take-down-and-republish: the ledger row already exists, so
  // the claim conflicts and no job is enqueued.
  await dispatchClipPublished(clipId)
  await dispatchClipPublished(clipId)

  assert.equal((await listDeliveries()).length, 1)
  assert.equal((await db.select({ id: job.id }).from(job)).length, 1)
})

test("a failed delivery still blocks a later re-announce", async () => {
  const author = await insertUser()
  await insertWebhook("discord")
  const clipId = await insertClip(author)

  await dispatchClipPublished(clipId)
  await db
    .update(webhookDelivery)
    .set({ status: "failed", error: "endpoint gone" })
  await db.delete(job)

  await dispatchClipPublished(clipId)

  const deliveries = await listDeliveries()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0]?.status, "failed")
  assert.equal((await db.select({ id: job.id }).from(job)).length, 0)
})

test("an author who opted out is never announced", async () => {
  const author = await insertUser({ announcements: false })
  await insertWebhook("discord")
  const clipId = await insertClip(author)

  await dispatchClipPublished(clipId)

  // No ledger row at all, so opting back in and republishing still works.
  assert.equal((await listDeliveries()).length, 0)
})

test("only ready public clips by live authors are announced", async () => {
  const author = await insertUser()
  await insertWebhook("discord")

  const unlisted = await insertClip(author, { privacy: "unlisted" })
  const priv = await insertClip(author, { privacy: "private" })
  const processing = await insertClip(author, { status: "processing" })
  for (const clipId of [unlisted, priv, processing]) {
    await dispatchClipPublished(clipId)
  }
  assert.equal((await listDeliveries()).length, 0)

  const disabledAuthor = await insertUser({ disabled: true })
  await dispatchClipPublished(await insertClip(disabledAuthor))
  assert.equal((await listDeliveries()).length, 0)
})

test("disabled webhooks are skipped, and a later one picks up the next publish", async () => {
  const author = await insertUser()
  const enabled = await insertWebhook("discord")
  await insertWebhook("generic", { enabled: false })
  const first = await insertClip(author)

  await dispatchClipPublished(first)
  assert.deepEqual(
    (await listDeliveries()).map((row) => row.webhookId),
    [enabled],
  )

  const added = await insertWebhook("generic")
  const second = await insertClip(author)
  await dispatchClipPublished(second)

  const forSecondClip = (await listDeliveries()).filter(
    (row) => row.clipId === second,
  )
  assert.deepEqual(
    forSecondClip.map((row) => row.webhookId).sort(compareText),
    [enabled, added].sort(compareText),
  )
})

function compareText(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "")
}

async function insertUser(
  options: { announcements?: boolean; disabled?: boolean } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(user).values({
    id,
    email: `${id}@example.test`,
    username: `user-${id.slice(0, 8)}`,
    clip_announcements_enabled: options.announcements ?? true,
    disabled_at: options.disabled ? new Date() : null,
  })
  return id
}

async function insertWebhook(
  provider: "discord" | "generic",
  options: { enabled?: boolean } = {},
): Promise<string> {
  const [row] = await db
    .insert(webhook)
    .values({
      name: `${provider} hook`,
      provider,
      url:
        provider === "discord"
          ? "https://discord.com/api/webhooks/1234/token"
          : "https://example.test/hook",
      enabled: options.enabled ?? true,
    })
    .returning({ id: webhook.id })
  return row.id
}

async function insertClip(
  authorId: string,
  options: {
    privacy?: "public" | "unlisted" | "private"
    status?: "pending" | "processing" | "ready" | "failed"
  } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(clip).values({
    id,
    author_id: authorId,
    title: "Webhook test clip",
    status: options.status ?? "ready",
    privacy: options.privacy ?? "public",
  })
  return id
}

function listDeliveries() {
  return db
    .select({
      id: webhookDelivery.id,
      webhookId: webhookDelivery.webhook_id,
      clipId: webhookDelivery.clip_id,
      dedupKey: webhookDelivery.dedup_key,
      status: webhookDelivery.status,
    })
    .from(webhookDelivery)
    .orderBy(webhookDelivery.created_at)
}
