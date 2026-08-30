import assert from "node:assert/strict"
import test from "node:test"

import { AdminAccessChangeMutex } from "./admin-access"

test("admin access changes serialize their full asynchronous boundary", async () => {
  const mutex = new AdminAccessChangeMutex()
  const releaseFirst = deferred<void>()
  const firstStarted = deferred<void>()
  const events: string[] = []

  const first = mutex.run(async () => {
    events.push("first:start")
    firstStarted.resolve()
    await releaseFirst.promise
    events.push("first:end")
  })
  await firstStarted.promise
  const second = mutex.run(async () => {
    events.push("second:start")
    events.push("second:end")
  })
  await nextTurn()
  assert.deepEqual(events, ["first:start"])

  releaseFirst.resolve()
  await Promise.all([first, second])
  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ])
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
