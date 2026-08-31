import assert from "node:assert/strict"
import test from "node:test"

import { GameAssetMutationGate } from "./game-asset-activity"

test("same-game mutations serialize their full asynchronous boundary", async () => {
  const gate = new GameAssetMutationGate()
  const events: string[] = []
  let releaseFirst!: () => void
  const hold = new Promise<void>((resolve) => (releaseFirst = resolve))
  const first = gate.run("GAME", async () => {
    events.push("first:start")
    await hold
    events.push("first:end")
  })
  const second = gate.run("game", async () => events.push("second"))
  await Promise.resolve()
  assert.deepEqual(events, ["first:start"])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ["first:start", "first:end", "second"])
})

test("different games can mutate concurrently", async () => {
  const gate = new GameAssetMutationGate()
  let entered = 0
  let release!: () => void
  const hold = new Promise<void>((resolve) => (release = resolve))
  const runs = ["a", "b"].map((id) =>
    gate.run(id, async () => {
      entered += 1
      await hold
    }),
  )
  await Promise.resolve()
  assert.equal(entered, 2)
  release()
  await Promise.all(runs)
})

test("a throwing mutation releases queued same-game work in FIFO order", async () => {
  const gate = new GameAssetMutationGate()
  const events: number[] = []
  let release!: () => void
  const hold = new Promise<void>((resolve) => (release = resolve))
  const first = gate.run("game", async () => {
    await hold
    throw new Error("expected")
  })
  const second = gate.run("game", async () => events.push(2))
  const third = gate.run("game", async () => events.push(3))
  release()
  await assert.rejects(first, /expected/)
  await Promise.all([second, third])
  assert.deepEqual(events, [2, 3])
})
