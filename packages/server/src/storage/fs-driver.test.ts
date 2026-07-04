import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { FsStorageDriver } from "@alloy/server/storage/fs-driver"

const roots: string[] = []

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  )
})

test("lists files recursively under a prefix", async () => {
  const root = await makeRoot()
  const driver = new FsStorageDriver({
    root,
    publicBaseUrl: "http://localhost",
    hmacSecret: "test-upload-hmac-secret-0000000000000",
  })
  const modified = new Date("2024-01-02T03:04:05.000Z")

  await mkdir(join(root, "aa/bb/clip-1/nested"), { recursive: true })
  await mkdir(join(root, "aa/bb/clip-2"), { recursive: true })
  await writeFile(join(root, "aa/bb/clip-1/source"), "source")
  await writeFile(join(root, "aa/bb/clip-1/nested/thumb.jpg"), "thumb")
  await writeFile(join(root, "aa/bb/clip-2/source"), "other")
  await utimes(join(root, "aa/bb/clip-1/source"), modified, modified)

  const keys: { key: string; lastModified: Date | null }[] = []
  for await (const entry of driver.list("aa/bb/clip-1")) {
    keys.push(entry)
  }

  assert.deepEqual(keys.map((entry) => entry.key).sort(), [
    "aa/bb/clip-1/nested/thumb.jpg",
    "aa/bb/clip-1/source",
  ])
  assert.equal(
    keys
      .find((entry) => entry.key === "aa/bb/clip-1/source")
      ?.lastModified?.getTime(),
    modified.getTime(),
  )
})

test("missing list prefix yields no entries", async () => {
  const root = await makeRoot()
  const driver = new FsStorageDriver({
    root,
    publicBaseUrl: "http://localhost",
    hmacSecret: "test-upload-hmac-secret-0000000000000",
  })

  const keys = []
  for await (const entry of driver.list("missing")) {
    keys.push(entry.key)
  }

  assert.deepEqual(keys, [])
})

test(
  "list tolerates entries deleted during recursive walk",
  {
    skip: "Requires deleting an entry between private walkFiles readdir and stat without mocks, which is intentionally race-dependent.",
  },
  () => {},
)

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "alloy-fs-driver-"))
  roots.push(root)
  return root
}
