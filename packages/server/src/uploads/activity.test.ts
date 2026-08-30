import assert from "node:assert/strict"
import test from "node:test"

import { UploadActivityGate } from "./activity"

test("stopped cleanup drains active uploads and fences late writers", async () => {
  const gate = new UploadActivityGate()
  const events: string[] = []
  const activeRelease = deferred<void>()
  const cleanupRelease = deferred<void>()

  const active = gate.withActivity("CLIP-ID", async () => {
    events.push("active:start")
    await activeRelease.promise
    events.push("active:end")
  })
  await nextTurn()

  const cleanup = gate.withStopped("clip-id", async () => {
    events.push("cleanup:start")
    await cleanupRelease.promise
    events.push("cleanup:end")
  })
  const late = gate.withActivity("clip-id", async () => {
    events.push("late")
  })
  await nextTurn()
  assert.deepEqual(events, ["active:start"])

  activeRelease.resolve()
  await active
  await nextTurn()
  assert.deepEqual(events, ["active:start", "active:end", "cleanup:start"])

  cleanupRelease.resolve()
  await Promise.all([cleanup, late])
  assert.deepEqual(events, [
    "active:start",
    "active:end",
    "cleanup:start",
    "cleanup:end",
    "late",
  ])
})

test("concurrent upload activity shares a clip gate", async () => {
  const gate = new UploadActivityGate()
  const release = deferred<void>()
  let entered = 0
  const runs = [1, 2].map(() =>
    gate.withActivity("clip", async () => {
      entered += 1
      await release.promise
    }),
  )
  await nextTurn()
  assert.equal(entered, 2)
  release.resolve()
  await Promise.all(runs)
})

test("same-ID re-init drains a legacy orphan token before replacing it", async () => {
  const gate = new UploadActivityGate()
  const activeRelease = deferred<void>()
  const events: string[] = []
  const tickets = new Set(["legacy"])

  const activeLegacyToken = gate.withActivity("CLIP-ID", async () => {
    assert.equal(tickets.has("legacy"), true)
    events.push("legacy:resolved")
    await activeRelease.promise
    events.push("legacy:wrote")
  })
  await nextTurn()

  const reinit = gate.withStopped("clip-id", async () => {
    events.push("reinit:start")
    tickets.delete("legacy")
    tickets.add("versioned")
    events.push("reinit:committed")
  })
  const lateLegacyToken = gate.withActivity("clip-id", async () => {
    events.push(
      tickets.has("legacy") ? "late-legacy:wrote" : "late-legacy:rejected",
    )
  })
  await nextTurn()
  assert.deepEqual(events, ["legacy:resolved"])

  activeRelease.resolve()
  await Promise.all([activeLegacyToken, reinit, lateLegacyToken])
  assert.deepEqual(events, [
    "legacy:resolved",
    "legacy:wrote",
    "reinit:start",
    "reinit:committed",
    "late-legacy:rejected",
  ])
  assert.deepEqual([...tickets], ["versioned"])
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
