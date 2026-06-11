import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import test from "node:test"

import { validateImageBytes } from "./image-validation"

test("validateImageBytes accepts valid webp bytes", () => {
  assert.deepEqual(validateImageBytes(minimalVp8xWebp(16, 9), "image/webp"), {
    ok: true,
    width: 16,
    height: 9,
    contentType: "image/webp",
  })
})

test("validateImageBytes rejects html bytes", () => {
  const result = validateImageBytes(
    Buffer.from("<!doctype html><script>alert(1)</script>"),
    "image/webp",
  )

  assert.equal(result.ok, false)
  assert.equal(result.error, "Unsupported or invalid image data")
})

test("validateImageBytes rejects png bytes declared as webp", () => {
  const result = validateImageBytes(minimalPng(4, 4), "image/webp")

  assert.equal(result.ok, false)
  assert.equal(result.error, "Image content type did not match bytes")
})

function minimalVp8xWebp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30)
  bytes.write("RIFF", 0, "ascii")
  bytes.writeUInt32LE(22, 4)
  bytes.write("WEBP", 8, "ascii")
  bytes.write("VP8X", 12, "ascii")
  bytes.writeUInt32LE(10, 16)
  writeUInt24LE(bytes, 24, width - 1)
  writeUInt24LE(bytes, 27, height - 1)
  return bytes
}

function minimalPng(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function writeUInt24LE(bytes: Buffer, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >> 8) & 0xff
  bytes[offset + 2] = (value >> 16) & 0xff
}
