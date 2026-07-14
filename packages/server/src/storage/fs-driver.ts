import { createReadStream, createWriteStream } from "node:fs"
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
import { pipeline } from "node:stream/promises"

import {
  dirname,
  isAbsolute,
  normalize,
  relative,
  resolve,
} from "@alloy/server/runtime/path"

import type {
  AbortUploadInput,
  CompleteUploadInput,
  MintUploadUrlInput,
  ResolvedObject,
  StorageDriver,
  WriteUploadPartInput,
} from "./driver"
import {
  contentTypeForExt,
  extname,
  fileExists,
  fsCreateReadStream,
  isCopyFallbackError,
  isOsErrorCode,
  markLinkedPublishTime,
  uploadPartExpectedBytes,
  UploadPartTooLargeError,
  walkFsFiles,
} from "./fs-driver-helpers"
import { mintFsUploadTicket, type UploadTokenPayload } from "./fs-upload-token"

export { decodeUploadToken } from "./fs-upload-token"
export { UploadPartTooLargeError } from "./fs-driver-helpers"

const FS_UPLOAD_CHUNK_SIZE_BYTES = 32 * 1024 * 1024

interface FsDriverOptions {
  root: string
  publicBaseUrl: string
  hmacSecret: string
}

export class FsStorageDriver implements StorageDriver {
  constructor(private readonly opts: FsDriverOptions) {}

  /** Resolve a storageKey against the configured root. */
  fullPath(key: string): string {
    const normalizedKey = normalize(key)
    if (
      isAbsolute(key) ||
      normalizedKey === ".." ||
      normalizedKey.startsWith("../")
    ) {
      throw new Error("Storage key escapes storage root")
    }

    const root = normalize(resolve(this.opts.root))
    const resolved = normalize(`${root}/${normalizedKey}`)
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
      await file.close()
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
        return fsCreateReadStream(full, opts?.start, opts?.end)
      },
      size: stats.size,
      contentType: contentTypeForExt(extname(full)),
      lastModified: stats.mtime ?? null,
    }
  }

  async mintUploadUrl(input: MintUploadUrlInput) {
    const expiresAt = Math.floor(Date.now() / 1000) + input.expiresInSec
    const payload: UploadTokenPayload = {
      k: input.key,
      ct: input.contentType,
      mb: input.maxBytes,
      exp: expiresAt,
      uid: input.userId,
      cid: input.clipId,
      m: "fs-chunked",
      cs: FS_UPLOAD_CHUNK_SIZE_BYTES,
    }
    return mintFsUploadTicket({
      payload,
      publicBaseUrl: this.opts.publicBaseUrl,
      secret: this.opts.hmacSecret,
      headers: {},
      strategy: { type: "chunked", chunkSizeBytes: FS_UPLOAD_CHUNK_SIZE_BYTES },
    })
  }

  async writeUploadPart(
    input: WriteUploadPartInput,
  ): Promise<{ size: number }> {
    const maxPartBytes = uploadPartExpectedBytes(
      input.partNumber,
      input.partSizeBytes,
      input.maxBytes,
    )
    const dir = this.partDir(input.key)
    await mkdir(dir, { recursive: true })
    const finalPath = this.partPath(input.key, input.partNumber)
    const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`
    const file = await open(tmpPath, "w")
    let size = 0
    let limitTripped = false

    try {
      for await (const chunk of input.body) {
        size += chunk.byteLength
        if (size > maxPartBytes) {
          limitTripped = true
          throw new Error("upload part exceeded expected size")
        }
        await file.write(chunk)
      }
      if (size !== maxPartBytes) {
        throw new Error("upload part size did not match expected size")
      }
      await file.close()
      await rename(tmpPath, finalPath)
      return { size }
    } catch (err) {
      await file.close().catch(() => undefined)
      await rm(tmpPath, { force: true }).catch(() => undefined)
      if (limitTripped) throw new UploadPartTooLargeError()
      throw err
    }
  }

  async completeUpload(input: CompleteUploadInput): Promise<void> {
    const partSizeBytes = input.partSizeBytes
    if (!partSizeBytes) {
      throw new Error("Filesystem chunk completion requires partSizeBytes")
    }
    const dst = this.fullPath(input.key)
    if (await fileExists(dst)) {
      throw new Error("Upload ticket has already been used")
    }

    await mkdir(dirname(dst), { recursive: true })
    const tmpPath = `${dst}.${crypto.randomUUID()}.tmp`
    const partCount = Math.ceil(input.maxBytes / partSizeBytes)
    try {
      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        const partPath = this.partPath(input.key, partNumber)
        const stats = await stat(partPath)
        const expected = uploadPartExpectedBytes(
          partNumber,
          partSizeBytes,
          input.maxBytes,
        )
        if (!stats.isFile() || stats.size !== expected) {
          throw new Error("Upload part size did not match declared size")
        }
        await pipeline(
          createReadStream(partPath),
          createWriteStream(tmpPath, { flags: partNumber === 1 ? "w" : "a" }),
        )
      }
      const stats = await stat(tmpPath)
      if (stats.size !== input.maxBytes) {
        throw new Error("Upload size did not match declared size")
      }
      await rename(tmpPath, dst)
      await rm(this.partDir(input.key), { recursive: true, force: true })
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => undefined)
      throw err
    }
  }

  async abortUpload(input: AbortUploadInput): Promise<void> {
    await rm(this.partDir(input.key), { recursive: true, force: true })
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
      const stats = await stat(dst)
      return { size: stats.size }
    }
    await markLinkedPublishTime(dst)
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
      const stats = await stat(dst)
      return { size: stats.size }
    }
    await markLinkedPublishTime(dst)
    const stats = await stat(dst)
    return { size: stats.size }
  }

  async delete(key: string): Promise<void> {
    const full = this.fullPath(key)
    try {
      await rm(full)
    } catch (err) {
      if (!isOsErrorCode(err, "ENOENT")) throw err
    }
    await rm(this.partDir(key), { recursive: true, force: true })
    await this.pruneEmptyAncestors(dirname(full))
  }

  async *list(
    prefix: string,
  ): AsyncIterable<{ key: string; lastModified: Date | null }> {
    const root = normalize(resolve(this.opts.root))
    const start = this.fullPath(prefix)
    let stats: Awaited<ReturnType<typeof stat>>
    try {
      stats = await stat(start)
    } catch (err) {
      if (isOsErrorCode(err, "ENOENT")) return
      throw err
    }
    if (!stats.isDirectory()) return

    for await (const entry of walkFsFiles(start)) {
      yield {
        key: relative(root, entry.path),
        lastModified: entry.lastModified,
      }
    }
  }

  private partDir(key: string): string {
    return `${this.fullPath(key)}.parts`
  }

  private partPath(key: string, partNumber: number): string {
    return `${this.partDir(key)}/${partNumber}.part`
  }

  private async pruneEmptyAncestors(startDir: string): Promise<void> {
    const root = normalize(resolve(this.opts.root))
    let current = normalize(startDir)
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
