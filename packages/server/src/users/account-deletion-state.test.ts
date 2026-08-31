import assert from "node:assert/strict"
import test from "node:test"

import {
  accountDeletionCounterRepairPlan,
  canonicalIds,
  postgresErrorHasCode,
  retryPostgresDeadlocks,
  withCanonicalUploadTargetsStopped,
} from "./account-deletion"
import { AccountDeletionState } from "./account-deletion-state"

test("concurrent account deletes share one operation and result", async () => {
  const state = new AccountDeletionState()
  const release = deferred<void>()
  let calls = 0
  const first = state.run("AA-user", async () => {
    calls += 1
    await release.promise
    return "deleted" as const
  })
  const second = state.run("aa-USER", async () => {
    throw new Error("deduplication failed")
  })

  assert.equal(first, second)
  assert.equal(state.isActive("aa-user"), true)
  release.resolve()
  assert.equal(await first, "deleted")
  assert.equal(await second, "deleted")
  assert.equal(calls, 1)
  assert.equal(state.isActive("aa-user"), false)
})

test("deletion drains an earlier reactivation and fences later ones", async () => {
  const state = new AccountDeletionState()
  const releaseActivity = deferred<void>()
  const activityStarted = deferred<void>()
  const activity = state.withInactive("user-id", async () => {
    activityStarted.resolve()
    await releaseActivity.promise
    return "reactivated"
  })
  await activityStarted.promise

  let deletionStarted = false
  const deletion = state.run("USER-ID", async () => {
    deletionStarted = true
    return "deleted"
  })
  await nextTurn()
  assert.equal(deletionStarted, false)
  assert.deepEqual(
    await state.withInactive("user-id", async () => "too-late"),
    { ok: false },
  )

  releaseActivity.resolve()
  assert.deepEqual(await activity, { ok: true, value: "reactivated" })
  assert.equal(await deletion, "deleted")
  assert.equal(deletionStarted, true)
})

test("an earlier clip initiation drains before disable and a later one is rejected", async () => {
  const state = new AccountDeletionState()
  const releaseInitiate = deferred<void>()
  const initiateStarted = deferred<void>()
  const initiate = state.withInactive("clip-owner", async () => {
    initiateStarted.resolve()
    await releaseInitiate.promise
  })
  await initiateStarted.promise

  let disabled = false
  const deletion = state.run("clip-owner", async () => {
    disabled = true
    return "deleted"
  })
  assert.deepEqual(
    await state.withInactive("clip-owner", async () => "late-initiate"),
    { ok: false },
  )
  assert.equal(disabled, false)

  releaseInitiate.resolve()
  await initiate
  assert.equal(await deletion, "deleted")
  assert.equal(disabled, true)
})

test("upload targets are deduplicated and acquired in canonical nesting order", async () => {
  const events: string[] = []
  const result = await withCanonicalUploadTargetsStopped(
    ["BB", "aa", "AA", "cc"],
    async () => {
      events.push("operation")
      return 42
    },
    async (targetId, operation) => {
      events.push(`enter:${targetId}`)
      try {
        return await operation()
      } finally {
        events.push(`exit:${targetId}`)
      }
    },
  )

  assert.equal(result, 42)
  assert.deepEqual(events, [
    "enter:aa",
    "enter:bb",
    "enter:cc",
    "operation",
    "exit:cc",
    "exit:bb",
    "exit:aa",
  ])
})

test("counter repair IDs and nested PostgreSQL deadlocks are recognized", () => {
  assert.deepEqual(canonicalIds(["BB", "aa", "AA"]), ["aa", "bb"])
  assert.deepEqual(
    accountDeletionCounterRepairPlan({
      authoredCommentClipIds: ["CC", "aa"],
      likedClipIds: ["BB", "AA"],
      likedCommentIds: ["DD", "dd", "cc"],
    }),
    {
      affectedClipIds: ["aa", "bb", "cc"],
      affectedCommentIds: ["cc", "dd"],
    },
  )
  assert.equal(
    postgresErrorHasCode({ cause: { cause: { code: "40P01" } } }, "40P01"),
    true,
  )
  assert.equal(postgresErrorHasCode({ code: "23503" }, "40P01"), false)
})

test("deadlock retries are bounded and unwrap nested driver causes", async () => {
  let attempts = 0
  const result = await retryPostgresDeadlocks(async () => {
    attempts += 1
    if (attempts < 3) throw { cause: { code: "40P01" } }
    return "committed"
  }, 4)
  assert.equal(result, "committed")
  assert.equal(attempts, 3)

  let terminalAttempts = 0
  await assert.rejects(
    retryPostgresDeadlocks(async () => {
      terminalAttempts += 1
      throw Object.assign(new Error("foreign key"), { code: "23503" })
    }, 4),
  )
  assert.equal(terminalAttempts, 1)
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
