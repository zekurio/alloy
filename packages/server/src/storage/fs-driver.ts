import { createReadStream } from "node:fs"
import {
  copyFile,
  link,
  mkdir,
  open,
  rename,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { Readable } from "node:stream"

import type {
  MintUploadUrlInput,
  ResolvedObject,
  StorageDriver,
  UploadTicket,
} from "./driver"
import { mintFsUploadTicket, type UploadTokenPayload } from "./fs-upload-token"

export { decodeUploadToken } from "./fs-upload-token"

interface FsDriverOptions {
  root: string
  publicBaseUrl: string
  hmacSecret: string
}

export class FsStorageDriver implements StorageDriver {
  constructor(private readonly opts: FsDriverOptions) {}

  /** Resolve a storageKey against the configured root. */
  fullPath(key: string): string {
    const root = normalizePath(this.opts.root)
    const resolved = normalizePath(`${root}/${key}`)
    if (resolved !== root && !resolved.startsWith(`${root}/`)) {
      throw new Error("Storage key escapes storage root")
    }
    return resolved
  }

  async put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    _contentType: string,
  ): Promise<{ size: number }> {
    const dst = this.fullPath(key)
    await mkdir(dirname(dst), { recursive: true })

    if (body instanceof Uint8Array) {
      await writeFile(dst, body)
      return { size: body.byteLength }
    }

    let size = 0
    const file = await open(dst, "w")
    try {
      for await (const chunk of body) {
        size += chunk.byteLength
        await file.write(chunk)
      }
    } finally {
      file.close()
    }
    return { size }
  }

  async resolve(key: string): Promise<ResolvedObject | null> {
    const full = this.fullPath(key)
    let stats: Awaited<ReturnType<typeof stat>>
    try {
      stats = await stat(full)
    } catch (err) {
      if (isOsErrorCode(err, "ENOENT")) return null
      throw err
    }
    if (!stats.isFile()) return null

    return {
      stream: (opts) => {
        return fspCreateReadStream(full, opts?.start, opts?.end)
      },
      size: stats.size,
      contentType: contentTypeForExt(extname(full)),
      lastModified: stats.mtime ?? null,
    }
  }

  async mintUploadUrl(input: MintUploadUrlInput): Promise<UploadTicket> {
    const expiresAt = Math.floor(Date.now() / 1000) + input.expiresInSec
    const payload: UploadTokenPayload = {
      k: input.key,
      ct: input.contentType,
      mb: input.maxBytes,
      exp: expiresAt,
      uid: input.userId,
      cid: input.clipId,
    }
    return mintFsUploadTicket({
      payload,
      publicBaseUrl: this.opts.publicBaseUrl,
      secret: this.opts.hmacSecret,
    })
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const src = this.fullPath(key)
    await mkdir(dirname(destPath), { recursive: true })
    try {
      await rm(destPath).catch((err) => {
        if (!isOsErrorCode(err, "ENOENT")) throw err
      })
      await link(src, destPath)
      return
    } catch (err) {
      if (!isCopyFallbackError(err)) throw err
    }
    await copyFile(src, destPath)
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    _contentType: string,
  ): Promise<{ size: number }> {
    const dst = this.fullPath(key)
    await mkdir(dirname(dst), { recursive: true })
    await rm(dst).catch((err) => {
      if (!isOsErrorCode(err, "ENOENT")) throw err
    })
    try {
      await link(localPath, dst)
    } catch (err) {
      if (!isCopyFallbackError(err)) throw err
      await copyFile(localPath, dst)
    }
    const stats = await stat(dst)
    return { size: stats.size }
  }

  async copy(input: {
    fromKey: string
    toKey: string
    contentType: string
  }): Promise<{ size: number }> {
    const src = this.fullPath(input.fromKey)
    const dst = this.fullPath(input.toKey)
    await mkdir(dirname(dst), { recursive: true })
    await rm(dst).catch((err) => {
      if (!isOsErrorCode(err, "ENOENT")) throw err
    })
    try {
      await link(src, dst)
    } catch (err) {
      if (!isCopyFallbackError(err)) throw err
      const tmp = `${dst}.${crypto.randomUUID()}.tmp`
      await copyFile(src, tmp)
      await rename(tmp, dst)
    }
    const stats = await stat(dst)
    return { size: stats.size }
  }

  async delete(key: string): Promise<void> {
    const full = this.fullPath(key)
    try {
      await rm(full)
    } catch (err) {
      if (isOsErrorCode(err, "ENOENT")) return
      throw err
    }
    await this.pruneEmptyAncestors(dirname(full))
  }

  private async pruneEmptyAncestors(startDir: string): Promise<void> {
    const root = normalizePath(this.opts.root)
    let current = normalizePath(startDir)
    while (true) {
      if (current === root || !current.startsWith(`${root}/`)) return
      try {
        await rmdir(current)
      } catch (err) {
        if (
          isOsErrorCode(err, "ENOENT") ||
          isOsErrorCode(err, "ENOTEMPTY") ||
          isOsErrorCode(err, "EEXIST")
        ) {
          return
        }
        throw err
      }
      current = dirname(current)
    }
  }
}

function fspCreateReadStream(
  path: string,
  start: number | undefined,
  end: number | undefined,
): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    createReadStream(path, { start, end }),
  ) as ReadableStream<Uint8Array>
}

function normalizePath(value: string): string {
  const absolute = value.startsWith("/") ? value : `${process.cwd()}/${value}`
  const parts: string[] = []
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return `/${parts.join("/")}`
}

function dirname(value: string): string {
  const normalized = normalizePath(value)
  const index = normalized.lastIndexOf("/")
  return index <= 0 ? "/" : normalized.slice(0, index)
}

function extname(value: string): string {
  const base = value.slice(value.lastIndexOf("/") + 1)
  const index = base.lastIndexOf(".")
  return index <= 0 ? "" : base.slice(index)
}

function isCopyFallbackError(err: unknown): boolean {
  return (
    isOsErrorCode(err, "EXDEV") ||
    isOsErrorCode(err, "EACCES") ||
    isOsErrorCode(err, "EPERM") ||
    isOsErrorCode(err, "ENOSYS")
  )
}

function isOsErrorCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code
}

function contentTypeForExt(ext: string): string {
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
