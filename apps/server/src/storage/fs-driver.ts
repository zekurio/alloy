import type {
  DownloadUrl,
  MintDownloadUrlInput,
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
    _contentType: string
  ): Promise<{ size: number }> {
    const dst = this.fullPath(key)
    await Deno.mkdir(dirname(dst), { recursive: true })

    if (body instanceof Uint8Array) {
      await Deno.writeFile(dst, body)
      return { size: body.byteLength }
    }

    let size = 0
    const file = await Deno.open(dst, {
      create: true,
      write: true,
      truncate: true,
    })
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
    let stat: Awaited<ReturnType<typeof Deno.stat>>
    try {
      stat = await Deno.stat(full)
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null
      throw err
    }
    if (!stat.isFile) return null

    return {
      stream: (opts) => {
        return fspCreateReadStream(full, opts?.start, opts?.end)
      },
      size: stat.size,
      contentType: contentTypeForExt(extname(full)),
      lastModified: stat.mtime ?? null,
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
    await Deno.mkdir(dirname(destPath), { recursive: true })
    try {
      await Deno.remove(destPath).catch((err) => {
        if (!(err instanceof Deno.errors.NotFound)) throw err
      })
      await Deno.link(src, destPath)
      return
    } catch (err) {
      if (!isCopyFallbackError(err)) throw err
    }
    await Deno.copyFile(src, destPath)
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    _contentType: string
  ): Promise<{ size: number }> {
    const dst = this.fullPath(key)
    await Deno.mkdir(dirname(dst), { recursive: true })
    await Deno.remove(dst).catch((err) => {
      if (!(err instanceof Deno.errors.NotFound)) throw err
    })
    try {
      await Deno.link(localPath, dst)
    } catch (err) {
      if (!isCopyFallbackError(err)) throw err
      await Deno.copyFile(localPath, dst)
    }
    const stat = await Deno.stat(dst)
    return { size: stat.size }
  }

  async copy(input: {
    fromKey: string
    toKey: string
    contentType: string
  }): Promise<{ size: number }> {
    const src = this.fullPath(input.fromKey)
    const dst = this.fullPath(input.toKey)
    await Deno.mkdir(dirname(dst), { recursive: true })
    await Deno.remove(dst).catch((err) => {
      if (!(err instanceof Deno.errors.NotFound)) throw err
    })
    try {
      await Deno.link(src, dst)
    } catch (err) {
      if (!isCopyFallbackError(err)) throw err
      const tmp = `${dst}.${crypto.randomUUID()}.tmp`
      await Deno.copyFile(src, tmp)
      await Deno.rename(tmp, dst)
    }
    const stat = await Deno.stat(dst)
    return { size: stat.size }
  }

  async mintDownloadUrl(
    _key: string,
    _input: MintDownloadUrlInput
  ): Promise<DownloadUrl | null> {
    // Fs driver has no presigned-URL concept — callers fall back to
    // streaming through resolve().
    return null
  }

  async delete(key: string): Promise<void> {
    const full = this.fullPath(key)
    try {
      await Deno.remove(full)
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return
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
        await Deno.remove(current)
      } catch (err) {
        if (
          err instanceof Deno.errors.NotFound ||
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
  end: number | undefined
): ReadableStream<Uint8Array> {
  const file = Deno.openSync(path, { read: true })
  if (start !== undefined) file.seekSync(start, Deno.SeekMode.Start)
  const limit = end === undefined ? undefined : end - (start ?? 0) + 1
  if (limit === undefined) return file.readable

  let remaining = limit
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (remaining <= 0) return
      try {
        const chunk = new Uint8Array(Math.min(64 * 1024, remaining))
        const bytesRead = await file.read(chunk)
        if (bytesRead === null) {
          remaining = 0
          file.close()
          controller.close()
          return
        }
        remaining -= bytesRead
        controller.enqueue(chunk.subarray(0, bytesRead))
        if (remaining <= 0) {
          file.close()
          controller.close()
        }
      } catch (err) {
        file.close()
        throw err
      }
    },
    cancel() {
      file.close()
    },
  })
}

function normalizePath(value: string): string {
  const absolute = value.startsWith("/") ? value : `${Deno.cwd()}/${value}`
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
    err instanceof Deno.errors.PermissionDenied ||
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
