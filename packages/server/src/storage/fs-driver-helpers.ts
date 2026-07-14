import { createReadStream } from "node:fs"
import { readdir, stat, utimes } from "node:fs/promises"
import { Readable } from "node:stream"

export async function* walkFsFiles(
  dir: string,
): AsyncIterable<{ path: string; lastModified: Date | null }> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
    if (isOsErrorCode(err, "ENOENT")) return
    throw err
  })
  if (!entries) return
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      yield* walkFsFiles(path)
      continue
    }
    if (!entry.isFile()) continue
    const stats = await stat(path).catch((err) => {
      if (isOsErrorCode(err, "ENOENT")) return null
      throw err
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

export function fsCreateReadStream(
  path: string,
  start: number | undefined,
  end: number | undefined,
): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    createReadStream(path, { start, end }),
  ) as ReadableStream<Uint8Array>
}

export class UploadPartTooLargeError extends Error {
  constructor() {
    super("Upload part exceeded expected size")
    this.name = "UploadPartTooLargeError"
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
  } catch (err) {
    if (isOsErrorCode(err, "ENOENT")) return false
    throw err
  }
}

export function extname(value: string): string {
  const base = value.slice(value.lastIndexOf("/") + 1)
  const index = base.lastIndexOf(".")
  return index <= 0 ? "" : base.slice(index)
}

export function isCopyFallbackError(err: unknown): boolean {
  return (
    isOsErrorCode(err, "EXDEV") ||
    isOsErrorCode(err, "EACCES") ||
    isOsErrorCode(err, "EPERM") ||
    isOsErrorCode(err, "ENOSYS")
  )
}

export function isOsErrorCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code
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
