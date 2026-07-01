import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"

import { bytesToBase64Url } from "@alloy/server/encoding/base64url"

import {
  decodeUploadToken,
  mintFsUploadTicket,
  type UploadTokenPayload,
} from "./fs-upload-token"

const secret = "0123456789abcdef0123456789abcdef"
const otherSecret = "abcdef0123456789abcdef0123456789"
const textEncoder = new TextEncoder()

function basePayload(overrides: Partial<UploadTokenPayload> = {}) {
  return {
    k: "clips/staged/source.mp4",
    ct: "video/mp4",
    mb: 1_000_000,
    exp: Math.floor(Date.now() / 1000) + 60,
    uid: "user-1",
    cid: "clip-1",
    m: "single" as const,
    cs: undefined,
    ...overrides,
  }
}

async function mintToken(payload: UploadTokenPayload, value = secret) {
  const ticket = await mintFsUploadTicket({
    payload,
    publicBaseUrl: "http://localhost:2552",
    secret: value,
  })
  return new URL(ticket.uploadUrl).pathname.split("/").at(-1) ?? ""
}

function signedToken(payloadBytes: Uint8Array, value = secret) {
  return `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(
    createHmac("sha256", value).update(payloadBytes).digest(),
  )}`
}

test("round-trips a valid upload token", async () => {
  const payload = basePayload({
    m: "fs-chunked",
    cs: 5_242_880,
  })

  assert.deepEqual(await decodeUploadToken(await mintToken(payload), secret), {
    ok: true,
    payload,
  })
})

test("rejects tokens minted with another secret", async () => {
  assert.deepEqual(
    await decodeUploadToken(
      await mintToken(basePayload(), otherSecret),
      secret,
    ),
    { ok: false, reason: "bad-signature" },
  )
})

test("rejects tampered payload bytes", async () => {
  const token = await mintToken(basePayload())
  const dot = token.indexOf(".")
  const payloadBytes = textEncoder.encode('{"k":"tampered"}')

  assert.deepEqual(
    await decodeUploadToken(
      `${bytesToBase64Url(payloadBytes)}.${token.slice(dot + 1)}`,
      secret,
    ),
    { ok: false, reason: "bad-signature" },
  )
})

test("rejects wrong-length signatures as malformed", async () => {
  const payload = bytesToBase64Url(
    textEncoder.encode(JSON.stringify(basePayload())),
  )
  const thirtyOneByteSig = bytesToBase64Url(new Uint8Array(31))
  const thirtyThreeByteSig = bytesToBase64Url(new Uint8Array(33))

  assert.deepEqual(
    await decodeUploadToken(`${payload}.${thirtyOneByteSig}`, secret),
    {
      ok: false,
      reason: "malformed",
    },
  )
  assert.deepEqual(
    await decodeUploadToken(`${payload}.${thirtyThreeByteSig}`, secret),
    {
      ok: false,
      reason: "malformed",
    },
  )
})

test("rejects missing token separators as malformed", async () => {
  for (const token of ["abc", ".abc", "abc."]) {
    assert.deepEqual(await decodeUploadToken(token, secret), {
      ok: false,
      reason: "malformed",
    })
  }
})

test("rejects non-base64url payloads or signatures as malformed", async () => {
  const token = await mintToken(basePayload())
  const dot = token.indexOf(".")

  assert.deepEqual(
    await decodeUploadToken(`not valid.${token.slice(dot + 1)}`, secret),
    { ok: false, reason: "malformed" },
  )
  assert.deepEqual(
    await decodeUploadToken(`${token.slice(0, dot)}.not valid`, secret),
    { ok: false, reason: "malformed" },
  )
})

test("rejects correctly signed payloads that fail schema validation", async () => {
  assert.deepEqual(
    await decodeUploadToken(
      signedToken(
        textEncoder.encode(
          JSON.stringify({ ...basePayload(), exp: undefined }),
        ),
      ),
      secret,
    ),
    { ok: false, reason: "malformed" },
  )
})

test("rejects expired tokens", async () => {
  assert.deepEqual(
    await decodeUploadToken(
      await mintToken(basePayload({ exp: Math.floor(Date.now() / 1000) - 60 })),
      secret,
    ),
    { ok: false, reason: "expired" },
  )
})

test("accepts tokens expiring in the future", async () => {
  const payload = basePayload({ exp: Math.floor(Date.now() / 1000) + 5 })

  assert.deepEqual(await decodeUploadToken(await mintToken(payload), secret), {
    ok: true,
    payload,
  })
})
