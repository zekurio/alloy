import { bytesToBase64Url } from "../encoding/base64url"

const textEncoder = new TextEncoder()

export function randomBase64Url(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new Error("byteLength must be a positive safe integer")
  }
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value),
  )
  return bytesToBase64Url(new Uint8Array(digest))
}

export async function hmacSha256(
  payload: string | Uint8Array,
  secret: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const payloadBytes = typeof payload === "string"
    ? textEncoder.encode(payload)
    : payload
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, bytesToArrayBuffer(payloadBytes)),
  )
}

export function constantTimeEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) return false
  let diff = 0
  for (let i = 0; i < left.byteLength; i++) {
    diff |= left[i] ^ right[i]
  }
  return diff === 0
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}
