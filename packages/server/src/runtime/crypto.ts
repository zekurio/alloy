import { timingSafeEqual } from "node:crypto"

import { bytesToBase64Url } from "@alloy/server/encoding/base64url"

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

export function constantTimeEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}
