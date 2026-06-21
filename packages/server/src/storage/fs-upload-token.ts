import {
  base64UrlToBytes,
  bytesToBase64Url,
} from "@alloy/server/encoding/base64url"
import { constantTimeEqual, hmacSha256 } from "@alloy/server/runtime/crypto"

import type { UploadTicket, UploadTicketStrategy } from "./driver"

export type UploadTokenMode = "single" | "fs-chunked" | "s3-multipart"

export interface UploadTokenPayload {
  /** key - opaque storage key the bytes will land at */
  k: string
  /** contentType - MIME baked into the ticket */
  ct: string
  /** maxBytes - hard cap for the upload */
  mb: number
  /** exp - unix-seconds expiry */
  exp: number
  /** userId - auth-session owner the ticket was minted for */
  uid: string
  /** clipId - reserved clip row the ticket targets */
  cid: string
  /** mode - upload strategy baked into the signed ticket */
  m?: UploadTokenMode
  /** chunkSize - fixed part size for resumable upload strategies */
  cs?: number
  /** multipartUploadId - storage-native multipart upload identifier */
  mpu?: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

async function signToken(
  payload: UploadTokenPayload,
  secret: string,
): Promise<string> {
  const json = textEncoder.encode(JSON.stringify(payload))
  const sig = await hmacSha256(json, secret)
  return `${bytesToBase64Url(json)}.${bytesToBase64Url(sig)}`
}

export async function mintFsUploadTicket(input: {
  payload: UploadTokenPayload
  publicBaseUrl: string
  secret: string
  headers?: Record<string, string>
  strategy?: UploadTicketStrategy
}): Promise<UploadTicket> {
  const token = await signToken(input.payload, input.secret)
  const baseUrl = input.publicBaseUrl.replace(/\/+$/, "")
  return {
    uploadUrl: `${baseUrl}/api/assets/upload/${token}`,
    method: "POST",
    headers: input.headers ?? { "Content-Type": input.payload.ct },
    expiresAt: input.payload.exp,
    strategy: input.strategy,
  }
}

type DecodedToken =
  | { ok: true; payload: UploadTokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" }

function parseUploadTokenPayload(value: unknown): UploadTokenPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  if (
    typeof payload.k !== "string" ||
    !payload.k.trim() ||
    typeof payload.ct !== "string" ||
    !payload.ct.trim() ||
    typeof payload.uid !== "string" ||
    !payload.uid.trim() ||
    typeof payload.cid !== "string" ||
    !payload.cid.trim()
  ) {
    return null
  }
  if (
    typeof payload.mb !== "number" ||
    !Number.isSafeInteger(payload.mb) ||
    payload.mb <= 0 ||
    typeof payload.exp !== "number" ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= 0
  ) {
    return null
  }
  if (
    payload.m !== undefined &&
    payload.m !== "single" &&
    payload.m !== "fs-chunked" &&
    payload.m !== "s3-multipart"
  ) {
    return null
  }
  if (
    payload.cs !== undefined &&
    (typeof payload.cs !== "number" ||
      !Number.isSafeInteger(payload.cs) ||
      payload.cs <= 0)
  ) {
    return null
  }
  if (
    payload.mpu !== undefined &&
    (typeof payload.mpu !== "string" || !payload.mpu.trim())
  ) {
    return null
  }
  if (
    (payload.m === "fs-chunked" || payload.m === "s3-multipart") &&
    payload.cs === undefined
  ) {
    return null
  }
  if (payload.m === "s3-multipart" && payload.mpu === undefined) {
    return null
  }
  return {
    k: payload.k,
    ct: payload.ct,
    mb: payload.mb,
    exp: payload.exp,
    uid: payload.uid,
    cid: payload.cid,
    m: payload.m,
    cs: payload.cs,
    mpu: payload.mpu,
  }
}

export async function decodeUploadToken(
  token: string,
  secret: string,
): Promise<DecodedToken> {
  const dot = token.indexOf(".")
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" }
  }
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)

  let payloadBytes: Uint8Array
  let sigBytes: Uint8Array
  try {
    payloadBytes = base64UrlToBytes(payloadB64)
    sigBytes = base64UrlToBytes(sigB64)
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (payloadBytes.byteLength === 0 || sigBytes.byteLength !== 32) {
    return { ok: false, reason: "malformed" }
  }

  const expected = await hmacSha256(payloadBytes, secret)
  // `constantTimeEqual` requires equal-length buffers; the byte-length
  // check above gates that. Wrong-length sigs already returned malformed.
  if (!constantTimeEqual(expected, sigBytes)) {
    return { ok: false, reason: "bad-signature" }
  }

  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(textDecoder.decode(payloadBytes))
  } catch {
    return { ok: false, reason: "malformed" }
  }
  const payload = parseUploadTokenPayload(rawPayload)
  if (!payload) {
    return { ok: false, reason: "malformed" }
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" }
  }
  return { ok: true, payload }
}
