import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { mp4Layout } from "./mp4-layout"

function box(type: string, payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(header.byteLength + payload.byteLength, 0)
  header.write(type, 4, 4, "ascii")
  return Buffer.concat([header, payload])
}

function terminalBox(type: string, payload = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(0, 0)
  header.write(type, 4, 4, "ascii")
  return Buffer.concat([header, payload])
}

async function withMp4Fixture(
  name: string,
  bytes: Buffer,
  testBody: (path: string) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "alloy-mp4-layout-"))
  try {
    const path = join(dir, name)
    await writeFile(path, bytes)
    await testBody(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("mp4Layout detects streamable progressive MP4", async () => {
  await withMp4Fixture(
    "streamable.mp4",
    Buffer.concat([box("ftyp"), box("moov"), box("mdat")]),
    async (path) => {
      assert.equal(await mp4Layout(path), "streamable")
    },
  )
})

test("mp4Layout detects trailing moov MP4", async () => {
  await withMp4Fixture(
    "trailing.mp4",
    Buffer.concat([box("ftyp"), box("mdat"), box("moov")]),
    async (path) => {
      assert.equal(await mp4Layout(path), "trailing-moov")
    },
  )
})

test("mp4Layout treats fragmented MP4 as streamable", async () => {
  await withMp4Fixture(
    "fragmented.mp4",
    Buffer.concat([box("ftyp"), box("moov"), box("moof"), box("mdat")]),
    async (path) => {
      assert.equal(await mp4Layout(path), "streamable")
    },
  )
})

test("mp4Layout returns unknown for garbage and empty files", async () => {
  await withMp4Fixture(
    "garbage.bin",
    Buffer.from("not an mp4"),
    async (path) => {
      assert.equal(await mp4Layout(path), "unknown")
    },
  )
  await withMp4Fixture("empty.mp4", Buffer.alloc(0), async (path) => {
    assert.equal(await mp4Layout(path), "unknown")
  })
})

test("mp4Layout stops at size-zero terminal boxes", async () => {
  await withMp4Fixture(
    "terminal.mp4",
    Buffer.concat([box("ftyp"), terminalBox("mdat"), box("moov")]),
    async (path) => {
      assert.equal(await mp4Layout(path), "unknown")
    },
  )
})
