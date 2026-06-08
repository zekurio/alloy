const BASE64URL_RE = /^[A-Za-z0-9_-]*$/
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!BASE64URL_RE.test(value)) {
    throw new Error("Invalid base64url")
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

export function base64UrlEncodeText(value: string): string {
  return bytesToBase64Url(textEncoder.encode(value))
}

export function base64UrlDecodeText(value: string): string {
  return textDecoder.decode(base64UrlToBytes(value))
}
