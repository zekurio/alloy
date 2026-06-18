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
  const { k, ct, mb, exp, uid, cid, m, cs, mpu } = payload
  if (
    typeof k !== "string" ||
    !k.trim() ||
    typeof ct !== "string" ||
    !ct.trim() ||
    typeof uid !== "string" ||
    !uid.trim() ||
    typeof cid !== "string" ||
    !cid.trim()
  ) {
    return null
  }
  if (
    typeof mb !== "number" ||
    !Number.isSafeInteger(mb) ||
    mb <= 0 ||
    typeof exp !== "number" ||
    !Number.isSafeInteger(exp) ||
    exp <= 0
  ) {
    return null
  }
  if (
    m !== undefined &&
    m !== "single" &&
    m !== "fs-chunked" &&
    m !== "s3-multipart"
  ) {
    return null
  }
  if (
    cs !== undefined &&
    (typeof cs !== "number" || !Number.isSafeInteger(cs) || cs <= 0)
  ) {
    return null
  }
  if (mpu !== undefined && (typeof mpu !== "string" || !mpu.trim())) {
    return null
  }
  if ((m === "fs-chunked" || m === "s3-multipart") && cs === undefined) {
    return null
  }
  if (m === "s3-multipart" && mpu === undefined) {
    return null
  }
  return { k, ct, mb, exp, uid, cid, m, cs, mpu }
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
    rawPayload = JSON.parse(textDecoder.decode(payloadBytes)) as unknown
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
