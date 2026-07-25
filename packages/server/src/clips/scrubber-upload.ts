import {
  CLIP_SCRUBBER_COLUMNS,
  CLIP_SCRUBBER_MAX_BYTES,
  CLIP_SCRUBBER_SHEET_HEIGHT,
} from "@alloy/contracts"
import { clipThumbnailStorage } from "@alloy/server/storage/index"
import { resolveStagedUpload } from "@alloy/server/uploads/staged"
import { selectScrubberTicket } from "@alloy/server/uploads/tickets"
import sharp from "sharp"

import { clipScrubberKey } from "./scrubber"

const SCRUBBER_MAX_WIDTH = 8192
/**
 * Floor on cell width, so a technically well-formed but degenerate sheet
 * (e.g. 4x384) cannot replace the pipeline's real one.
 */
const SCRUBBER_MIN_CELL_WIDTH = 32

/**
 * Validates and sanitizes the optional desktop-generated sprite before it
 * enters the permanent thumbnail namespace. Invalid/missing uploads simply
 * leave the server media pipeline to generate its normal fallback.
 */
export async function promoteUploadedScrubber(
  clipId: string,
): Promise<boolean> {
  const ticket = await selectScrubberTicket({ type: "clip", id: clipId })
  if (
    !ticket ||
    ticket.contentType !== "image/jpeg" ||
    ticket.expectedBytes > CLIP_SCRUBBER_MAX_BYTES ||
    ticket.expiresAt <= new Date()
  ) {
    return false
  }
  const resolved = await resolveStagedUpload(ticket.storageKey)
  if (
    !resolved ||
    resolved.size !== ticket.expectedBytes ||
    resolved.size > CLIP_SCRUBBER_MAX_BYTES
  ) {
    return false
  }

  const bytes = await readScrubberBytes(resolved.stream())
  const normalized = await normalizeUploadedScrubber(bytes)
  await clipThumbnailStorage.put(
    clipScrubberKey(clipId),
    normalized,
    "image/jpeg",
  )
  return true
}

export async function normalizeUploadedScrubber(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  if (bytes.byteLength === 0 || bytes.byteLength > CLIP_SCRUBBER_MAX_BYTES) {
    throw new Error("Scrubber exceeds the allowed size.")
  }
  const image = sharp(bytes, {
    limitInputPixels: SCRUBBER_MAX_WIDTH * CLIP_SCRUBBER_SHEET_HEIGHT,
  })
  const metadata = await image.metadata()
  if (
    metadata.format !== "jpeg" ||
    metadata.height !== CLIP_SCRUBBER_SHEET_HEIGHT ||
    !metadata.width ||
    metadata.width > SCRUBBER_MAX_WIDTH ||
    metadata.width % CLIP_SCRUBBER_COLUMNS !== 0 ||
    metadata.width / CLIP_SCRUBBER_COLUMNS < SCRUBBER_MIN_CELL_WIDTH
  ) {
    throw new Error("Scrubber has an invalid sprite layout.")
  }
  return image.jpeg({ quality: 76 }).toBuffer()
}

async function readScrubberBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > CLIP_SCRUBBER_MAX_BYTES) {
      throw new Error("Scrubber upload exceeds the allowed size.")
    }
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
