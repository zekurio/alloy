import type { Buffer } from "node:buffer"

export type ImageValidationResult =
  | { ok: true; width: number; height: number; contentType: string }
  | { ok: false; error: string }

const MAX_IMAGE_PIXELS = 24_000_000

export function validateImageBytes(
  bytes: Buffer,
  expectedContentType: string
): ImageValidationResult {
  if (bytes.byteLength === 0) return { ok: false, error: "Empty image data" }

  const parsed = parseJpeg(bytes) ?? parsePng(bytes) ?? parseWebp(bytes) ?? null
  if (!parsed) return { ok: false, error: "Unsupported or invalid image data" }
  if (parsed.contentType !== expectedContentType) {
    return { ok: false, error: "Image content type did not match bytes" }
  }
  if (parsed.width < 1 || parsed.height < 1) {
    return { ok: false, error: "Invalid image dimensions" }
  }
  if (parsed.width * parsed.height > MAX_IMAGE_PIXELS) {
    return { ok: false, error: "Image dimensions are too large" }
  }
  return { ok: true, ...parsed }
}

function parseJpeg(
  bytes: Buffer
): { width: number; height: number; contentType: string } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    offset += 2
    if (marker === 0xd9 || marker === 0xda) break
    if (offset + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return null
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 7) return null
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
        contentType: "image/jpeg",
      }
    }
    offset += length
  }
  return null
}

function parsePng(
  bytes: Buffer
): { width: number; height: number; contentType: string } | null {
  const pngSig = "89504e470d0a1a0a"
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== pngSig) {
    return null
  }
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    contentType: "image/png",
  }
}

function parseWebp(
  bytes: Buffer
): { width: number; height: number; contentType: string } | null {
  if (
    bytes.length < 16 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null
  }
  const chunk = bytes.subarray(12, 16).toString("ascii")
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + readUInt24LE(bytes, 24),
      height: 1 + readUInt24LE(bytes, 27),
      contentType: "image/webp",
    }
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null
    }
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
      contentType: "image/webp",
    }
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b0 = bytes[21]
    const b1 = bytes[22]
    const b2 = bytes[23]
    const b3 = bytes[24]
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      contentType: "image/webp",
    }
  }
  return null
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}
