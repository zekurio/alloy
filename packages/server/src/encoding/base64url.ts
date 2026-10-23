const BASE64URL_RE = /^[A-Za-z0-9_-]*$/
const textDecoder = new TextDecoder()

export function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64url",
  )
}

export function base64UrlToBytes(value: string): Uint8Array {
  // Buffer skips characters outside the alphabet and a dangling final
  // character instead of failing, so reject both up front.
  if (!BASE64URL_RE.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url")
  }
  return new Uint8Array(Buffer.from(value, "base64url"))
}

export function base64UrlEncodeText(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

export function base64UrlDecodeText(value: string): string {
  return textDecoder.decode(base64UrlToBytes(value))
}
