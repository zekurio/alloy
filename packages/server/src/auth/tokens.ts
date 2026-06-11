import { randomBase64Url, sha256Base64Url } from "@alloy/server/runtime/crypto"

export {
  base64UrlToBytes,
  bytesToBase64Url,
} from "@alloy/server/encoding/base64url"

export function generateSessionToken(): string {
  return randomBase64Url(32)
}

export async function hashSessionToken(token: string): Promise<string> {
  return sha256Base64Url(token)
}
