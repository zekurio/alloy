import { bytesToBase64Url } from "../encoding/base64url"

export { base64UrlToBytes, bytesToBase64Url } from "../encoding/base64url"

const textEncoder = new TextEncoder()

export function generateSessionToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(token)
  )
  return bytesToBase64Url(new Uint8Array(digest))
}
