import { Buffer } from "node:buffer"
import { createReadStream, createWriteStream, promises as fsp } from "node:fs"
import path from "node:path"
import { PassThrough, Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

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
      forcePathStyle: opts.forcePathStyle,
    })
    if (this.cachedClient?.cacheKey === cacheKey) {
      return this.cachedClient.client
    }
    // If access keys aren't provided we let the SDK's default credential
    // chain take over — supports instance roles, workload identity, etc.
    const credentials =
      opts.accessKeyId && opts.secretAccessKey
        ? {
            accessKeyId: opts.accessKeyId,
            secretAccessKey: opts.secretAccessKey,
          }
        : undefined
    const client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials,
      // R2 rejects the SDK's default CRC32 on presigned PUTs.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
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
    if (Buffer.isBuffer(body)) {
      await client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      )
      return { size: body.byteLength }
    }
    let size = 0
    const counter = async function* (src: Readable) {
      for await (const chunk of src) {
        size += (chunk as Buffer).byteLength
        yield chunk as Buffer
      }
    }
    const upload = new Upload({
      client,
      params: {
        Bucket: opts.bucket,
        Key: key,
        Body: Readable.from(counter(body)),
        ContentType: contentType,
      },
    })
    await upload.done()
    return { size }
  }

  async resolve(key: string): Promise<ResolvedObject | null> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    let head
    try {
      head = await client.send(
        new HeadObjectCommand({ Bucket: opts.bucket, Key: key })
      )
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
    const size = Number(head.ContentLength ?? 0)
    const contentType = head.ContentType ?? "application/octet-stream"
    const lastModified = head.LastModified ?? null

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
    const cmd = new PutObjectCommand({
      Bucket: opts.bucket,
      Key: input.key,
      ContentLength: input.maxBytes,
      ContentType: input.contentType,
    })
    const url = await getSignedUrl(client, cmd, {
      expiresIn: input.expiresInSec,
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
      await client.send(
        new DeleteObjectCommand({ Bucket: opts.bucket, Key: key })
      )
    } catch (err) {
      if (isMissing(err)) return
      throw err
    }
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    await fsp.mkdir(path.dirname(destPath), { recursive: true })
    const resp = await client.send(
      new GetObjectCommand({ Bucket: opts.bucket, Key: key })
    )
    const body = resp.Body as Readable | undefined
    if (!body) {
      throw new Error(`s3: empty body for ${key}`)
    }
    await pipeline(body, createWriteStream(destPath))
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    contentType: string
  ): Promise<{ size: number }> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const stat = await fsp.stat(localPath)
    const upload = new Upload({
      client,
      params: {
        Bucket: opts.bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentType: contentType,
      },
    })
    await upload.done()
    return { size: stat.size }
  }

  async copy(input: {
    fromKey: string
    toKey: string
    contentType: string
  }): Promise<{ size: number }> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    await client.send(
      new CopyObjectCommand({
        Bucket: opts.bucket,
        Key: input.toKey,
        CopySource: `${opts.bucket}/${encodeS3CopySourceKey(input.fromKey)}`,
        ContentType: input.contentType,
        MetadataDirective: "REPLACE",
      })
    )
    const resolved = await this.resolve(input.toKey)
    return { size: resolved?.size ?? 0 }
  }

  async mintDownloadUrl(
    key: string,
    input: MintDownloadUrlInput
  ): Promise<DownloadUrl | null> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const cmd = new GetObjectCommand({
      Bucket: opts.bucket,
      Key: key,
      ResponseContentType: input.responseContentType,
      ResponseContentDisposition: input.responseContentDisposition,
      ResponseCacheControl: input.responseCacheControl,
    })
    const expiresIn = input.expiresInSec || opts.presignExpiresSec
    const url = await getSignedUrl(client, cmd, { expiresIn })
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
    const range =
      start !== undefined
        ? `bytes=${start}-${end !== undefined ? end : ""}`
        : undefined
    void (async () => {
      try {
        const resp = await client.send(
          new GetObjectCommand({
            Bucket: opts.bucket,
            Key: key,
            Range: range,
          })
        )
        const body = resp.Body as Readable | undefined
        if (!body) {
          pass.destroy(new Error(`s3: empty body for ${key}`))
          return
        }
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
    code === "NotFound"
  )
}

function encodeS3CopySourceKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")
}
