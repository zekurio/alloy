import { createHash, randomBytes } from "node:crypto"

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url")
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

export function base64UrlToBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64url"))
}
