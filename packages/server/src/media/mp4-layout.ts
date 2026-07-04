import { open } from "node:fs/promises"

import { runFfmpeg, transcodeTimeoutMs } from "./ffmpeg"

type Mp4Layout = "streamable" | "trailing-moov" | "unknown"

const BOX_HEADER_SIZE = 8
const LARGE_SIZE_HEADER_SIZE = 16
const FASTSTART_REMUX_TIMEOUT_SOURCE_MS = 60 * 60 * 1000

export async function mp4Layout(path: string): Promise<Mp4Layout> {
  let file
  try {
    file = await open(path, "r")
    const size = (await file.stat()).size
    let offset = 0
    let firstBox = true
    let mediaBeforeMoov = false

    while (offset < size) {
      const box = await readBoxHeader(file, offset, size)
      if (!box) return "unknown"
      if (firstBox && box.type !== "ftyp") return "unknown"
      firstBox = false

      if (box.type === "moov")
        return mediaBeforeMoov ? "trailing-moov" : "streamable"
      if (box.type === "mdat" || box.type === "moof") mediaBeforeMoov = true
      if (box.size === 0) return "unknown"

      offset += box.size
    }

    return "unknown"
  } catch {
    return "unknown"
  } finally {
    await file?.close().catch(() => undefined)
  }
}

/**
 * Normalize an ingested MP4 for progressive playback: when the moov trails
 * the media data, stream-copy remux to faststart and return the remuxed
 * path; otherwise (already streamable, unknown layout, or not MP4 at all)
 * return the input path untouched.
 */
export async function faststartPath(
  srcPath: string,
  outPath: string,
  contentType: string | null,
  signal?: AbortSignal,
): Promise<string> {
  if (contentType !== "video/mp4") return srcPath
  if ((await mp4Layout(srcPath)) !== "trailing-moov") return srcPath
  await remuxToFastStart(srcPath, outPath, signal)
  return outPath
}

async function remuxToFastStart(
  srcPath: string,
  outPath: string,
  signal?: AbortSignal,
): Promise<void> {
  await runFfmpeg({
    timeoutMs: transcodeTimeoutMs(FASTSTART_REMUX_TIMEOUT_SOURCE_MS),
    signal,
    args: [
      "-v",
      "error",
      "-y",
      "-i",
      srcPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outPath,
    ],
  })
}

async function readBoxHeader(
  file: Awaited<ReturnType<typeof open>>,
  offset: number,
  fileSize: number,
): Promise<{ type: string; size: number } | null> {
  const header = Buffer.alloc(BOX_HEADER_SIZE)
  const read = await file.read(header, 0, header.byteLength, offset)
  if (read.bytesRead !== header.byteLength) return null

  const size32 = header.readUInt32BE(0)
  const type = header.toString("ascii", 4, 8)
  if (size32 === 0) return { type, size: 0 }
  if (size32 === 1) {
    const largeSize = Buffer.alloc(8)
    const largeRead = await file.read(
      largeSize,
      0,
      largeSize.byteLength,
      offset + BOX_HEADER_SIZE,
    )
    if (largeRead.bytesRead !== largeSize.byteLength) return null
    const size = Number(largeSize.readBigUInt64BE(0))
    if (!Number.isSafeInteger(size) || size < LARGE_SIZE_HEADER_SIZE) {
      return null
    }
    if (offset + size > fileSize) return null
    return { type, size }
  }
  if (size32 < BOX_HEADER_SIZE) return null
  if (offset + size32 > fileSize) return null
  return { type, size: size32 }
}
