import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  readFile,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"

import {
  activeHousekeepingPaths,
  markHousekeepingPathActive,
  markHousekeepingPathInactive,
} from "./active-paths"
import { HousekeepingCoordinator, type HousekeepingTask } from "./core"
import {
  allowedUserDataRoot,
  createDesktopHousekeepingTasks,
  removeExactLegacyRoot,
} from "./tasks"

const temporaryRoots: string[] = []

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

test("retries failures and runs a changed task revision", async () => {
  const root = await temporaryRoot()
  const ledgerPath = join(root, "housekeeping", "state.json")
  let attempts = 0
  const task = (revision: number): HousekeepingTask => ({
    id: "migration",
    revision,
    intervalMs: null,
    run: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("interrupted")
      return { removedFiles: 0, removedBytes: 0 }
    },
  })
  const logger = { info() {}, warn() {} }

  const first = new HousekeepingCoordinator({
    ledgerPath,
    tasks: [task(1)],
    logger,
    now: () => 100,
  })
  await first.runDue()
  await first.runDue()
  await first.runDue()
  assert.equal(attempts, 2)

  await new HousekeepingCoordinator({
    ledgerPath,
    tasks: [task(2)],
    logger,
    now: () => 200,
  }).runDue()
  assert.equal(attempts, 3)
  assert.deepEqual(JSON.parse(await readFile(ledgerPath, "utf8")), {
    version: 1,
    tasks: { migration: { revision: 2, succeededAt: 200 } },
  })
})

test("deduplicates concurrent lane requests", async () => {
  const root = await temporaryRoot()
  let releases = 0
  const coordinator = new HousekeepingCoordinator({
    ledgerPath: join(root, "state.json"),
    tasks: [
      {
        id: "slow",
        revision: 1,
        intervalMs: null,
        run: async () => {
          await new Promise<void>((resolve) => setImmediate(resolve))
          releases += 1
          return { removedFiles: 0, removedBytes: 0 }
        },
      },
    ],
    logger: { info() {}, warn() {} },
  })

  await Promise.all([coordinator.runDue(), coordinator.runDue()])
  assert.equal(releases, 1)
})

test("keeps a path active until every consumer releases it", () => {
  const path = "/recording-exports/export.mp4"
  markHousekeepingPathActive("export", path)
  markHousekeepingPathActive("export", path)

  markHousekeepingPathInactive("export", path)
  assert.equal(activeHousekeepingPaths("export").has(path), true)

  markHousekeepingPathInactive("export", path)
  assert.equal(activeHousekeepingPaths("export").has(path), false)
})

test("rejects roots outside the allowlist and user data", async () => {
  const root = await temporaryRoot()
  assert.throws(() => allowedUserDataRoot(root, "recordings"))
  assert.throws(() => allowedUserDataRoot(root, "../asset-cache"))
})

test("removes only the exact legacy scrubber directory", async () => {
  const root = await temporaryRoot()
  const scrubbers = join(root, "recording-scrubbers")
  const thumbnails = join(root, "recording-thumbnails")
  await mkdir(scrubbers)
  await mkdir(thumbnails)
  await writeFile(join(scrubbers, "old.jpg"), "old")
  await writeFile(join(thumbnails, "keep.jpg"), "keep")

  const result = await removeExactLegacyRoot(
    allowedUserDataRoot(root, "recording-scrubbers"),
    new AbortController().signal,
  )

  await assert.rejects(stat(scrubbers))
  assert.equal(await readFile(join(thumbnails, "keep.jpg"), "utf8"), "keep")
  assert.deepEqual(result, { removedFiles: 1, removedBytes: 3 })
})

test("recurring import sweep keeps fresh and active files", async () => {
  const root = await temporaryRoot()
  const logs = join(root, "logs")
  const imports = join(root, "recording-library-imports")
  await mkdir(logs)
  await mkdir(imports)
  const stale = join(imports, "00000000-0000-0000-0000-000000000001.mp4")
  const active = join(imports, "00000000-0000-0000-0000-000000000002.mp4")
  const fresh = join(imports, "00000000-0000-0000-0000-000000000003.mp4")
  await Promise.all([
    writeFile(stale, "stale"),
    writeFile(active, "active"),
    writeFile(fresh, "fresh"),
  ])
  const old = new Date(1_000)
  await Promise.all([utimes(stale, old, old), utimes(active, old, old)])
  const tasks = createDesktopHousekeepingTasks({
    userData: root,
    logs,
    activeAssetPaths: () => new Set(),
    activeAudioPaths: () => new Set(),
    activeExportPaths: () => new Set(),
    activeImportPaths: () => new Set([active]),
    now: () => 2 * 24 * 60 * 60 * 1000,
  })
  const task = tasks.find(
    (candidate) => candidate.id === "prune-staged-recording-imports",
  )
  assert.ok(task)

  const result = await task.run(new AbortController().signal)

  await assert.rejects(stat(stale))
  assert.equal(await readFile(active, "utf8"), "active")
  assert.equal(await readFile(fresh, "utf8"), "fresh")
  assert.deepEqual(result, { removedFiles: 1, removedBytes: 5 })
})

test("rechecks active paths before deleting a stale file", async () => {
  const root = await temporaryRoot()
  const logs = join(root, "logs")
  const imports = join(root, "recording-library-imports")
  await mkdir(logs)
  await mkdir(imports)
  const stale = join(imports, "00000000-0000-0000-0000-000000000004.mp4")
  await writeFile(stale, "stale")
  const old = new Date(1_000)
  await utimes(stale, old, old)
  let activeChecks = 0
  const tasks = createDesktopHousekeepingTasks({
    userData: root,
    logs,
    activeAssetPaths: () => new Set(),
    activeAudioPaths: () => new Set(),
    activeExportPaths: () => new Set(),
    activeImportPaths: () => {
      activeChecks += 1
      return activeChecks > 1 ? new Set([stale]) : new Set()
    },
    now: () => 2 * 24 * 60 * 60 * 1000,
  })
  const task = tasks.find(
    (candidate) => candidate.id === "prune-staged-recording-imports",
  )
  assert.ok(task)

  const result = await task.run(new AbortController().signal)

  assert.equal(await readFile(stale, "utf8"), "stale")
  assert.deepEqual(result, { removedFiles: 0, removedBytes: 0 })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "alloy-housekeeping-"))
  temporaryRoots.push(root)
  return root
}
