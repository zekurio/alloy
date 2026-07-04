import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "job store postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
  await prepareTestDatabase("store")

  const { job } = await import("@alloy/db/schema")
  const { db, client } = await import("@alloy/server/db/index")
  const { defineJobKind } = await import("./registry")
  const store = await import("./store")
  const { eq, sql } = await import("drizzle-orm")
  const { z } = await import("zod")

  const PayloadSchema = z.object({ value: z.string().optional() }).default({})

  defineJobKind({
    kind: "test.order",
    queue: "maintenance",
    schema: PayloadSchema,
    defaultPriority: 50,
    retry: { maxAttempts: 3, backoffMs: 1000 },
    handler() {},
  })

  defineJobKind({
    kind: "test.dedup",
    queue: "maintenance",
    schema: PayloadSchema,
    defaultPriority: 50,
    retry: { maxAttempts: 3, backoffMs: 1000 },
    handler() {},
  })

  defineJobKind({
    kind: "test.singleton",
    queue: "maintenance",
    schema: PayloadSchema,
    defaultPriority: 50,
    retry: { maxAttempts: 3, backoffMs: 1000 },
    handler() {},
  })

  defineJobKind({
    kind: "test.recurring",
    queue: "maintenance",
    schema: PayloadSchema,
    defaultPriority: 70,
    retry: { maxAttempts: 3, backoffMs: 1000 },
    schedule: { everyMs: 60_000, runAtBoot: true },
    handler() {},
  })

  defineJobKind({
    kind: "test.retry",
    queue: "maintenance",
    schema: PayloadSchema,
    defaultPriority: 50,
    retry: { maxAttempts: 3, backoffMs: 1000 },
    handler() {},
  })

  defineJobKind({
    kind: "test.snooze",
    queue: "maintenance",
    schema: PayloadSchema,
    defaultPriority: 50,
    retry: { maxAttempts: 3, backoffMs: 1000 },
    handler() {},
  })

  after(() => client.end())

  beforeEach(async () => {
    await db.delete(job)
  })

  test("claim orders due jobs by priority then run_at", async () => {
    await store.enqueue(
      "test.order",
      { value: "late-low" },
      {
        priority: 10,
        runAt: secondsAgo(10),
      },
    )
    await store.enqueue(
      "test.order",
      { value: "early-default" },
      {
        priority: 50,
        runAt: secondsAgo(30),
      },
    )
    await store.enqueue(
      "test.order",
      { value: "late-default" },
      {
        priority: 50,
        runAt: secondsAgo(20),
      },
    )

    const first = await store.claim(["test.order"], crypto.randomUUID())
    const second = await store.claim(["test.order"], crypto.randomUUID())
    const third = await store.claim(["test.order"], crypto.randomUUID())

    assert.equal(payloadValue(first), "late-low")
    assert.equal(payloadValue(second), "early-default")
    assert.equal(payloadValue(third), "late-default")
  })

  test("dedup upsert replaces payload and takes min priority and run_at", async () => {
    const firstId = await store.enqueue(
      "test.dedup",
      { value: "old" },
      {
        priority: 50,
        runAt: secondsAgo(10),
        dedupKey: "same",
      },
    )
    const secondId = await store.enqueue(
      "test.dedup",
      { value: "new" },
      {
        priority: 10,
        runAt: secondsAgo(30),
        dedupKey: "same",
      },
    )

    assert.equal(secondId, firstId)

    const claimed = await store.claim(["test.dedup"], crypto.randomUUID())

    assert.equal(payloadValue(claimed), "new")
    assert.equal(claimed?.priority, 10)
    assert.ok(claimed?.run_at.getTime() && claimed.run_at <= secondsAgo(20))
  })

  test("pending dedup row coexists with a running row", async () => {
    const firstId = await store.enqueue(
      "test.dedup",
      { value: "running" },
      {
        dedupKey: "same",
      },
    )
    const running = await store.claim(["test.dedup"], crypto.randomUUID())
    const secondId = await store.enqueue(
      "test.dedup",
      { value: "pending" },
      {
        dedupKey: "same",
      },
    )

    assert.equal(running?.id, firstId)
    assert.notEqual(secondId, firstId)

    const rows = await db
      .select({ id: job.id, status: job.status })
      .from(job)
      .where(eq(job.kind, "test.dedup"))

    assert.equal(rows.filter((row) => row.status === "running").length, 1)
    assert.equal(rows.filter((row) => row.status === "pending").length, 1)
  })

  test("singleton claim skips pending while same singleton is running", async () => {
    await store.enqueue(
      "test.singleton",
      { value: "running" },
      {
        dedupKey: "test.singleton",
      },
    )
    await store.claim(["test.singleton"], crypto.randomUUID())
    await store.enqueue(
      "test.singleton",
      { value: "pending" },
      {
        dedupKey: "test.singleton",
      },
    )

    assert.equal(
      await store.claim(["test.singleton"], crypto.randomUUID()),
      null,
    )
  })

  test("stale running jobs are taken over after the lease window", async () => {
    const id = await store.enqueue("test.order", { value: "stale" })
    await store.claim(["test.order"], crypto.randomUUID())
    await db
      .update(job)
      .set({ locked_at: sql`now() - interval '3 minutes'` })
      .where(eq(job.id, id))

    const claimed = await store.claim(["test.order"], crypto.randomUUID())

    assert.equal(claimed?.id, id)
    assert.equal(claimed?.attempt, 2)
  })

  test("recurring completion re-arms the next singleton row transactionally", async () => {
    const id = await store.enqueue(
      "test.recurring",
      {},
      {
        dedupKey: "test.recurring",
      },
    )
    const claimed = await store.claim(["test.recurring"], crypto.randomUUID())

    assert.equal(claimed?.id, id)
    assert.equal(await store.complete(id, claimed?.lease_token ?? ""), true)

    const rows = await db
      .select({ status: job.status, dedupKey: job.dedup_key })
      .from(job)
      .where(eq(job.kind, "test.recurring"))

    assert.equal(rows.filter((row) => row.status === "completed").length, 1)
    assert.equal(
      rows.filter(
        (row) => row.status === "pending" && row.dedupKey === "test.recurring",
      ).length,
      1,
    )
  })

  test("retry uses linear backoff from the current attempt", async () => {
    const id = await store.enqueue("test.retry", {})
    const first = await store.claim(["test.retry"], crypto.randomUUID())

    assert.equal(first?.attempt, 1)
    assert.deepEqual(
      await store.fail(id, first?.lease_token ?? "", "fail", true),
      {
        changed: true,
        willRetry: true,
      },
    )
    assert.equal(await store.claim(["test.retry"], crypto.randomUUID()), null)

    await db
      .update(job)
      .set({ run_at: sql`now() - interval '1 second'` })
      .where(eq(job.id, id))

    const second = await store.claim(["test.retry"], crypto.randomUUID())

    assert.equal(second?.attempt, 2)
    assert.deepEqual(
      await store.fail(id, second?.lease_token ?? "", "fail again", true),
      {
        changed: true,
        willRetry: true,
      },
    )

    const delay = await client.query<{ delayMs: string }>(
      'select extract(epoch from (run_at - now())) * 1000 as "delayMs" from job where id = $1',
      [id],
    )

    assert.ok(Number(delay.rows[0]?.delayMs ?? 0) > 1500)
  })

  test("snooze returns to pending without consuming an attempt", async () => {
    const id = await store.enqueue("test.snooze", {})
    const first = await store.claim(["test.snooze"], crypto.randomUUID())

    assert.equal(first?.attempt, 1)
    assert.equal(
      await store.snooze(id, first?.lease_token ?? "", secondsAgo(1)),
      true,
    )

    const second = await store.claim(["test.snooze"], crypto.randomUUID())

    assert.equal(second?.id, id)
    assert.equal(second?.attempt, 1)
  })

  test("snooze absorbs pending dedup twin", async () => {
    const runningId = await store.enqueue(
      "test.snooze",
      { value: "running" },
      {
        priority: 50,
        runAt: secondsAgo(10),
        dedupKey: "same",
      },
    )
    const running = await store.claim(["test.snooze"], crypto.randomUUID())
    await store.enqueue(
      "test.snooze",
      { value: "pending" },
      {
        priority: 10,
        runAt: secondsAgo(30),
        dedupKey: "same",
      },
    )

    assert.equal(running?.id, runningId)
    assert.equal(
      await store.snooze(runningId, running?.lease_token ?? "", secondsAgo(5)),
      true,
    )

    const rows = await db
      .select({
        id: job.id,
        status: job.status,
        priority: job.priority,
        runAt: job.run_at,
      })
      .from(job)
      .where(eq(job.kind, "test.snooze"))

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.id, runningId)
    assert.equal(rows[0]?.status, "pending")
    assert.equal(rows[0]?.priority, 10)
    assert.ok(rows[0]?.runAt.getTime() && rows[0].runAt <= secondsAgo(20))
  })

  test("retry absorbs pending dedup twin", async () => {
    const failedId = await store.enqueue(
      "test.retry",
      { value: "failed" },
      {
        priority: 50,
        dedupKey: "same",
      },
    )
    const running = await store.claim(["test.retry"], crypto.randomUUID())

    assert.deepEqual(
      await store.fail(failedId, running?.lease_token ?? "", "fail", false),
      {
        changed: true,
        willRetry: false,
      },
    )

    await store.enqueue(
      "test.retry",
      { value: "pending" },
      {
        priority: 5,
        runAt: secondsAgo(30),
        dedupKey: "same",
      },
    )

    assert.equal(await store.retry(failedId), true)

    const rows = await db
      .select({
        id: job.id,
        status: job.status,
        priority: job.priority,
        runAt: job.run_at,
      })
      .from(job)
      .where(eq(job.kind, "test.retry"))

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.id, failedId)
    assert.equal(rows[0]?.status, "pending")
    assert.equal(rows[0]?.priority, 5)
    assert.ok(rows[0]?.runAt.getTime() && rows[0].runAt <= secondsAgo(20))
  })

  test("discardFailed deletes only terminally failed rows", async () => {
    const id = await store.enqueue("test.retry", {})
    const running = await store.claim(["test.retry"], crypto.randomUUID())
    await store.fail(id, running?.lease_token ?? "", "boom", false)

    assert.equal(await store.discardFailed(id), true)
    assert.equal(
      (await db.select({ id: job.id }).from(job).where(eq(job.id, id))).length,
      0,
    )

    const pendingId = await store.enqueue("test.retry", {})
    await store.claim(["test.retry"], crypto.randomUUID())
    assert.equal(await store.discardFailed(pendingId), false)
    assert.equal(
      (await db.select({ id: job.id }).from(job).where(eq(job.id, pendingId)))
        .length,
      1,
    )
  })

  test("nextPendingRunByKind reports the earliest pending run per kind", async () => {
    await store.enqueue(
      "test.order",
      { value: "late" },
      { runAt: secondsAgo(10) },
    )
    await store.enqueue(
      "test.order",
      { value: "early" },
      { runAt: secondsAgo(30) },
    )

    const next = await store.nextPendingRunByKind()
    const runAt = next.get("test.order")

    assert.ok(runAt && runAt <= secondsAgo(20))
  })
}

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000)
}

function payloadValue(row: { payload: unknown } | null): string | undefined {
  return typeof row?.payload === "object" &&
    row.payload !== null &&
    "value" in row.payload &&
    typeof row.payload.value === "string"
    ? row.payload.value
    : undefined
}
