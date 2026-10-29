import { type FileHandle, open, readdir, stat, utimes } from "node:fs/promises"

import { t } from "@alloy/contracts/schema"

const OsErrorSchema = t.object({ code: t.string().optional() })

export async function* walkFsFiles(
  dir: string,
): AsyncIterable<{ path: string; lastModified: Date | null }> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((cause) => {
    if (isOsErrorCode(cause, "ENOENT")) return
    throw cause
  })
  if (!entries) return
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      yield* walkFsFiles(path)
      continue
    }
    if (!entry.isFile()) continue
    const stats = await stat(path).catch((cause) => {
      if (isOsErrorCode(cause, "ENOENT")) return null
      throw cause
    })
    if (!stats) continue
    yield { path, lastModified: stats.mtime ?? null }
  }
}

export async function markLinkedPublishTime(path: string): Promise<void> {
  // Hardlinks inherit the source inode's timestamps. Refresh after publish so
  // mtime reflects when the storage object became visible, not when the source
  // upload/work file was originally written.
  const now = new Date()
  await utimes(path, now, now)
}

// fs.createReadStream's default read size.
const FILE_STREAM_CHUNK_BYTES = 64 * 1024

/**
 * Streams bytes `start` through `end` (inclusive) of a file. Each pull reads
 * the next chunk at its offset, so a slow client holds back the reads and at
 * most one chunk waits in the stream. Reading the file handle directly skips
 * the Node stream and the adapter that Readable.toWeb would add per chunk.
 */
export function fsCreateReadStream(
  path: string,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  let handle: FileHandle | null = null
  let position = start
  const release = async () => {
    const current = handle
    handle = null
    await current?.close()
  }
  return new ReadableStream<Uint8Array>({
    async start() {
      handle = await open(path, "r")
    },
    async pull(controller) {
      const size = Math.min(FILE_STREAM_CHUNK_BYTES, end - position + 1)
      if (!handle || size <= 0) {
        await release()
        controller.close()
        return
      }
      const chunk = Buffer.allocUnsafeSlow(size)
      let bytesRead: number
      try {
        ;({ bytesRead } = await handle.read(chunk, 0, size, position))
      } catch (err) {
        await release().catch(() => undefined)
        throw err
      }
      position += bytesRead
      if (bytesRead > 0) controller.enqueue(chunk.subarray(0, bytesRead))
      // A short read means the file ended early, e.g. it was truncated.
      if (bytesRead < size || position > end) {
        await release()
        controller.close()
      }
    },
    cancel: release,
  })
}

export class UploadPartTooLargeError extends Error {
  constructor() {
    super("Upload part exceeded expected size")
    this.name = "UploadPartTooLargeError"
  }
}

export class UploadPartSizeMismatchError extends Error {
  constructor() {
    super("Upload part size did not match expected size")
    this.name = "UploadPartSizeMismatchError"
  }
}

export function uploadPartExpectedBytes(
  partNumber: number,
  partSizeBytes: number,
  maxBytes: number,
): number {
  if (!Number.isSafeInteger(partNumber) || partNumber <= 0) {
    throw new Error("Invalid upload part number")
  }
  const offset = (partNumber - 1) * partSizeBytes
  if (offset >= maxBytes) {
    throw new Error("Upload part is outside declared size")
  }
  return Math.min(partSizeBytes, maxBytes - offset)
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    return stats.isFile()
  } catch (cause) {
    if (isOsErrorCode(cause, "ENOENT")) return false
    throw cause
  }
}

export function extname(value: string): string {
  const base = value.slice(value.lastIndexOf("/") + 1)
  const index = base.lastIndexOf(".")
  return index <= 0 ? "" : base.slice(index)
}

export function isCopyFallbackError(cause: unknown): boolean {
  return (
    isOsErrorCode(cause, "EXDEV") ||
    isOsErrorCode(cause, "EACCES") ||
    isOsErrorCode(cause, "EPERM") ||
    isOsErrorCode(cause, "ENOSYS")
  )
}

export function isOsErrorCode(cause: unknown, code: string): boolean {
  const parsed = OsErrorSchema.safeParse(cause)
  return parsed.success && parsed.data.code === code
}

export function contentTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".mp4":
      return "video/mp4"
    case ".mov":
      return "video/quicktime"
    case ".mkv":
      return "video/x-matroska"
    case ".webm":
      return "video/webm"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".webp":
      return "image/webp"
    default:
      return "application/octet-stream"
  }
}
