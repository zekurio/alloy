import { Buffer } from "node:buffer"
import { createReadStream, createWriteStream, promises as fsp } from "node:fs"
import path from "node:path"
import { PassThrough, Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { S3Client } from "bun"

import type {
  DownloadUrl,
  MintDownloadUrlInput,
  MintUploadUrlInput,
  ResolvedObject,
  StorageDriver,
  UploadTicket,
} from "./driver"

export interface S3DriverOptions {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle?: boolean
  presignExpiresSec: number
}

type S3DriverOptionsProvider = () => S3DriverOptions

export class S3StorageDriver implements StorageDriver {
  private readonly optionsProvider: S3DriverOptionsProvider
  private cachedClient: { cacheKey: string; client: S3Client } | null = null

  constructor(opts: S3DriverOptions | S3DriverOptionsProvider) {
    this.optionsProvider = typeof opts === "function" ? opts : () => opts
  }

  private getOptions(): S3DriverOptions {
    const opts = this.optionsProvider()
    const accessKeyId = normalizeOptional(opts.accessKeyId)
    const secretAccessKey = normalizeOptional(opts.secretAccessKey)
    if (
      (accessKeyId && !secretAccessKey) ||
      (!accessKeyId && secretAccessKey)
    ) {
      throw new Error(
        "S3 storage runtime config must include both accessKeyId and secretAccessKey, or neither."
      )
    }
    return {
      ...opts,
      endpoint: normalizeOptional(opts.endpoint),
      accessKeyId,
      secretAccessKey,
    }
  }

  private getClient(opts: S3DriverOptions): S3Client {
    const cacheKey = JSON.stringify({
      region: opts.region,
      endpoint: opts.endpoint,
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    })
    if (this.cachedClient?.cacheKey === cacheKey) {
      return this.cachedClient.client
    }
    const client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      bucket: opts.bucket,
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    })
    this.cachedClient = { cacheKey, client }
    return client
  }

  async put(
    key: string,
    body: Buffer | Readable,
    contentType: string
  ): Promise<{ size: number }> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const file = client.file(key)
    if (Buffer.isBuffer(body)) {
      await file.write(body, { type: contentType })
      return { size: body.byteLength }
    }
    let size = 0
    const writer = file.writer({
      type: contentType,
      retry: 3,
    })
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.byteLength
      writer.write(buffer)
    }
    await writer.end()
    return { size }
  }

  async resolve(key: string): Promise<ResolvedObject | null> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    let stat
    try {
      stat = await client.stat(key)
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
    const size = Number(stat.size ?? 0)
    const contentType = stat.type ?? "application/octet-stream"
    const lastModified =
      stat.lastModified instanceof Date
        ? stat.lastModified
        : stat.lastModified
          ? new Date(stat.lastModified)
          : null

    return {
      stream: (opts) => this.openStream(key, opts?.start, opts?.end),
      size,
      contentType,
      lastModified,
    }
  }

  async mintUploadUrl(input: MintUploadUrlInput): Promise<UploadTicket> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const url = client.presign(input.key, {
      expiresIn: input.expiresInSec,
      method: "PUT",
      type: input.contentType,
    })
    return {
      uploadUrl: url,
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
      },
      expiresAt: Math.floor(Date.now() / 1000) + input.expiresInSec,
    }
  }

  async delete(key: string): Promise<void> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    try {
      await client.delete(key)
    } catch (err) {
      if (isMissing(err)) return
      throw err
    }
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    await fsp.mkdir(path.dirname(destPath), { recursive: true })
    const body = Readable.fromWeb(client.file(key).stream())
    await pipeline(body, createWriteStream(destPath))
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    contentType: string
  ): Promise<{ size: number }> {
    const stat = await fsp.stat(localPath)
    await this.put(key, createReadStream(localPath), contentType)
    return { size: stat.size }
  }

  async copy(input: {
    fromKey: string
    toKey: string
    contentType: string
  }): Promise<{ size: number }> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const sourceUrl = client.presign(input.fromKey, {
      expiresIn: opts.presignExpiresSec,
      method: "GET",
    })
    const source = await fetch(sourceUrl)
    if (!source.ok || !source.body) {
      throw new Error(
        `s3: copy source ${input.fromKey} returned ${source.status}`
      )
    }
    await client.file(input.toKey).write(source, { type: input.contentType })
    const resolved = await this.resolve(input.toKey)
    return { size: resolved?.size ?? 0 }
  }

  async mintDownloadUrl(
    key: string,
    input: MintDownloadUrlInput
  ): Promise<DownloadUrl | null> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const expiresIn = input.expiresInSec || opts.presignExpiresSec
    const url = client.presign(key, {
      expiresIn,
      method: "GET",
      type: input.responseContentType,
      contentDisposition: input.responseContentDisposition,
    })
    return {
      url,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    }
  }

  private openStream(
    key: string,
    start: number | undefined,
    end: number | undefined
  ): Readable {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const pass = new PassThrough()
    void (async () => {
      try {
        const file = client.file(key)
        const body = Readable.fromWeb(
          start === undefined
            ? file.stream()
            : file
                .slice(start, end === undefined ? undefined : end + 1)
                .stream()
        )
        body.on("error", (err) => pass.destroy(err))
        body.pipe(pass)
      } catch (err) {
        pass.destroy(err as Error)
      }
    })()
    return pass
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isMissing(err: unknown): boolean {
  const name = (err as { name?: string; Code?: string } | null)?.name
  const code = (err as { name?: string; Code?: string } | null)?.Code
  return (
    name === "NotFound" ||
    name === "NoSuchKey" ||
    code === "NoSuchKey" ||
    code === "NotFound" ||
    code === "ENOENT"
  )
}
