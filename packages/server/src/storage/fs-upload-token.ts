import { t } from "@alloy/contracts/schema"
import {
  base64UrlToBytes,
  bytesToBase64Url,
} from "@alloy/server/encoding/base64url"
import { constantTimeEqual, hmacSha256 } from "@alloy/server/runtime/crypto"

import type { UploadTicket, UploadTicketStrategy } from "./driver"

export type UploadTokenMode = "single" | "fs-chunked"

const NonBlankTokenString = t
  .string()
  .refine((value) => value.trim().length > 0)
const UploadTokenPayloadSchema = t
  .object({
    /** key - opaque storage key the bytes will land at */
    k: NonBlankTokenString,
    /** contentType - MIME baked into the ticket */
    ct: NonBlankTokenString,
    /** maxBytes - hard cap for the upload */
    mb: t.number().int().positive().refine(Number.isSafeInteger),
    /** exp - unix-seconds expiry */
    exp: t.number().int().positive().refine(Number.isSafeInteger),
    /** userId - auth-session owner the ticket was minted for */
    uid: NonBlankTokenString,
    /** clipId - reserved clip row the ticket targets */
    cid: NonBlankTokenString,
    /** mode - upload strategy baked into the signed ticket */
    m: t.enum(["single", "fs-chunked"]).optional(),
    /** chunkSize - fixed part size for resumable upload strategies */
    cs: t.number().int().positive().refine(Number.isSafeInteger).optional(),
  })
  .refine(
    (payload) => payload.m !== "fs-chunked" || payload.cs !== undefined,
    "Chunked upload tokens require a chunk size.",
  )

export type UploadTokenPayload = t.infer<typeof UploadTokenPayloadSchema>

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

function parseUploadTokenPayload(
  value: Parameters<typeof UploadTokenPayloadSchema.safeParse>[0],
): UploadTokenPayload | null {
  const parsed = UploadTokenPayloadSchema.safeParse(value)
  return parsed.success ? parsed.data : null
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
