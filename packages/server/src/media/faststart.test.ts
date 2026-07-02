import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { isFastStartFile, moovPrecedesMdat } from "./faststart"

test("moovPrecedesMdat reports true when moov is before mdat", async () => {
  const fixture = Buffer.concat([box("ftyp"), box("moov"), box("mdat")])

  assert.equal(
    await moovPrecedesMdat(readFixture(fixture), fixture.length),
    true,
  )
})

test("moovPrecedesMdat reports false when mdat is before moov", async () => {
  const fixture = Buffer.concat([box("ftyp"), box("mdat"), box("moov")])

  assert.equal(
    await moovPrecedesMdat(readFixture(fixture), fixture.length),
    false,
  )
})

test("moovPrecedesMdat skips ftyp and free padding before moov", async () => {
  const fixture = Buffer.concat([
    box("ftyp"),
    box("free", Buffer.alloc(32)),
    box("moov"),
    box("mdat"),
  ])

  assert.equal(
    await moovPrecedesMdat(readFixture(fixture), fixture.length),
    true,
  )
})

test("moovPrecedesMdat reports false for 64-bit largesize mdat before moov", async () => {
  const fixture = Buffer.concat([largeBox("mdat"), box("moov")])

  assert.equal(
    await moovPrecedesMdat(readFixture(fixture), fixture.length),
    false,
  )
})

test("moovPrecedesMdat reports false for size-zero tail moov after mdat", async () => {
  const fixture = Buffer.concat([box("mdat"), sizeZeroBox("moov")])

  assert.equal(
    await moovPrecedesMdat(readFixture(fixture), fixture.length),
    false,
  )
})

test("moovPrecedesMdat reports false for truncated headers", async () => {
  const fixture = Buffer.from([0, 0, 0, 8, 0x66])

  assert.equal(
    await moovPrecedesMdat(readFixture(fixture), fixture.length),
    false,
  )
})

test("moovPrecedesMdat reports false for normal boxes smaller than their header", async () => {
  const fixture = Buffer.from([0, 0, 0, 4, 0x66, 0x72, 0x65, 0x65])

  assert.equal(
    await moovPrecedesMdat(readFixture(fixture), fixture.length),
    false,
  )
})

test("isFastStartFile reads fixtures from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alloy-faststart-"))
  try {
    const fastPath = join(dir, "fast.mp4")
    const slowPath = join(dir, "slow.mp4")
    await writeFile(fastPath, Buffer.concat([box("moov"), box("mdat")]))
    await writeFile(slowPath, Buffer.concat([box("mdat"), box("moov")]))

    assert.equal(await isFastStartFile(fastPath), true)
    assert.equal(await isFastStartFile(slowPath), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function readFixture(fixture: Buffer) {
  return async (offset: number, length: number) =>
    fixture.subarray(offset, offset + length)
}

function box(type: string, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(header.byteLength + payload.byteLength, 0)
  header.write(type, 4, 4, "ascii")
  return Buffer.concat([header, payload])
}

function largeBox(type: string, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(16)
  header.writeUInt32BE(1, 0)
  header.write(type, 4, 4, "ascii")
  header.writeBigUInt64BE(BigInt(header.byteLength + payload.byteLength), 8)
  return Buffer.concat([header, payload])
}

function sizeZeroBox(type: string) {
  const header = Buffer.alloc(8)
  header.write(type, 4, 4, "ascii")
  return header
}
