import assert from "node:assert/strict"

import { test } from "vite-plus/test"

import { webhookFailurePlan } from "../webhooks/delivery-policy"
import { WakeableSerialWorker } from "./wakeable-serial-worker"

test("outbox worker drains available work serially", async () => {
  let remaining = 2
  let calls = 0
  const idle = deferred<void>()
  const worker = new WakeableSerialWorker({
    reconciliationIntervalMs: 60_000,
    async runOne() {
      calls += 1
      if (remaining > 0) {
        remaining -= 1
        return { worked: true }
      }
      idle.resolve()
      return { worked: false, nextRunAt: null }
    },
    onError: () => assert.fail("outbox worker unexpectedly failed"),
  })

  worker.start()
  await idle.promise
  assert.equal(calls, 3)
  await worker.stop()
})

test("a wake racing an active drain schedules an immediate second pass", async () => {
  let calls = 0
  const entered = deferred<void>()
  const release = deferred<void>()
  const repumped = deferred<void>()
  const worker = new WakeableSerialWorker({
    reconciliationIntervalMs: 60_000,
    async runOne() {
      calls += 1
      if (calls === 1) {
        entered.resolve()
        await release.promise
      } else {
        repumped.resolve()
      }
      return { worked: false, nextRunAt: null }
    },
    onError: () => assert.fail("outbox worker unexpectedly failed"),
  })

  worker.start()
  await entered.promise
  worker.wake()
  release.resolve()
  await repumped.promise
  assert.equal(calls, 2)
  await worker.stop()
})

test("stopping aborts and joins an in-flight pass", async () => {
  const entered = deferred<void>()
  let aborted = false
  const worker = new WakeableSerialWorker({
    reconciliationIntervalMs: 60_000,
    async runOne(signal) {
      entered.resolve()
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true
            resolve()
          },
          { once: true },
        )
      })
      return { worked: false, nextRunAt: null }
    },
    onError: (cause) => {
      throw cause
    },
  })

  worker.start()
  await entered.promise
  await worker.stop()
  assert.equal(aborted, true)
})

test("starting after a stop rescans durable work without a wake", async () => {
  let available = false
  let calls = 0
  const firstIdle = deferred<void>()
  const delivered = deferred<void>()
  const worker = new WakeableSerialWorker({
    reconciliationIntervalMs: 60_000,
    async runOne() {
      calls += 1
      if (calls === 1) firstIdle.resolve()
      if (!available) return { worked: false, nextRunAt: null }
      available = false
      delivered.resolve()
      return { worked: true }
    },
    onError: () => assert.fail("outbox worker unexpectedly failed"),
  })

  worker.start()
  await firstIdle.promise
  await worker.stop()

  available = true
  worker.start()
  await delivered.promise
  assert.ok(calls >= 2)
  await worker.stop()
})

test("an idle worker wakes at the persisted next-run deadline", async () => {
  let calls = 0
  const reachedDeadline = deferred<void>()
  const worker = new WakeableSerialWorker({
    reconciliationIntervalMs: 60_000,
    async runOne() {
      calls += 1
      if (calls === 1) {
        return {
          worked: false,
          nextRunAt: new Date(Date.now() + 20),
        }
      }
      reachedDeadline.resolve()
      return { worked: false, nextRunAt: null }
    },
    onError: () => assert.fail("outbox worker unexpectedly failed"),
  })

  worker.start()
  await reachedDeadline.promise
  assert.equal(calls, 2)
  await worker.stop()
})

test("webhook retry deadlines are persisted as explicit times", () => {
  const attemptedAt = new Date("2026-01-01T00:00:00.000Z")
  assert.deepEqual(webhookFailurePlan(0, attemptedAt), {
    attempts: 1,
    terminal: false,
    nextAttemptAt: new Date("2026-01-01T00:00:30.000Z"),
  })
  assert.deepEqual(webhookFailurePlan(4, attemptedAt), {
    attempts: 5,
    terminal: true,
    nextAttemptAt: attemptedAt,
  })
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
