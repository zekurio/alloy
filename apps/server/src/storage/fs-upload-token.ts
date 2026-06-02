import { base64UrlToBytes, bytesToBase64Url } from "../encoding/base64url"
import { constantTimeEqual, hmacSha256 } from "../runtime/crypto"
import type { UploadTicket } from "./driver"

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
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

async function signToken(
  payload: UploadTokenPayload,
  secret: string
): Promise<string> {
  const json = textEncoder.encode(JSON.stringify(payload))
  const sig = await hmacSha256(json, secret)
  return `${bytesToBase64Url(json)}.${bytesToBase64Url(sig)}`
}

export async function mintFsUploadTicket(input: {
  payload: UploadTokenPayload
  publicBaseUrl: string
  secret: string
}): Promise<UploadTicket> {
  const token = await signToken(input.payload, input.secret)
  const baseUrl = input.publicBaseUrl.replace(/\/+$/, "")
  return {
    uploadUrl: `${baseUrl}/api/assets/upload/${token}`,
    method: "POST",
    headers: { "Content-Type": input.payload.ct },
    expiresAt: input.payload.exp,
  }
}

type DecodedToken =
  | { ok: true; payload: UploadTokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" }

function parseUploadTokenPayload(value: unknown): UploadTokenPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const { k, ct, mb, exp, uid, cid } = payload
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
  return { k, ct, mb, exp, uid, cid }
}

export async function decodeUploadToken(
  token: string,
  secret: string
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
