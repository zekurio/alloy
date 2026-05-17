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

export async function signToken(
  payload: UploadTokenPayload,
  secret: string
): Promise<string> {
  const json = textEncoder.encode(JSON.stringify(payload))
  const sig = await hmacSha256(json, secret)
  return `${base64UrlEncode(json)}.${base64UrlEncode(sig)}`
}

export type DecodedToken =
  | { ok: true; payload: UploadTokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" }

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
    payloadBytes = base64UrlDecode(payloadB64)
    sigBytes = base64UrlDecode(sigB64)
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (payloadBytes.byteLength === 0 || sigBytes.byteLength !== 32) {
    return { ok: false, reason: "malformed" }
  }

  const expected = await hmacSha256(payloadBytes, secret)
  // `timingSafeEqual` requires equal-length buffers; the byte-length
  // check above gates that. Wrong-length sigs already returned malformed.
  if (!constantTimeEqual(expected, sigBytes)) {
    return { ok: false, reason: "bad-signature" }
  }

  let payload: UploadTokenPayload
  try {
    payload = JSON.parse(textDecoder.decode(payloadBytes)) as UploadTokenPayload
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (
    typeof payload.k !== "string" ||
    typeof payload.ct !== "string" ||
    typeof payload.mb !== "number" ||
    typeof payload.exp !== "number" ||
    typeof payload.uid !== "string" ||
    typeof payload.cid !== "string"
  ) {
    return { ok: false, reason: "malformed" }
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" }
  }
  return { ok: true, payload }
}

async function hmacSha256(
  payload: Uint8Array,
  secret: string
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, bytesToArrayBuffer(payload))
  )
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url")
  }
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let diff = 0
  for (let i = 0; i < left.byteLength; i++) {
    diff |= left[i] ^ right[i]
  }
  return diff === 0
}
