import { Buffer } from "node:buffer"
import { createReadStream, createWriteStream, promises as fsp } from "node:fs"
import path from "node:path"
import { PassThrough, Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3"
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
      bucket: opts.bucket,
      region: opts.region,
      endpoint: opts.endpoint,
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      forcePathStyle: opts.forcePathStyle,
    })
    if (this.cachedClient?.cacheKey === cacheKey) {
      return this.cachedClient.client
    }
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
    if (Buffer.isBuffer(body)) {
      await this.putStream(opts, key, body, contentType, body.byteLength)
      return { size: body.byteLength }
    }

    let size = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.byteLength
        callback(null, chunk)
      },
    })
    const stream = new PassThrough()
    const upload = this.putStream(opts, key, stream, contentType)
    await pipeline(body, counter, stream)
    await upload
    return { size }
  }

  private async putStream(
    opts: S3DriverOptions,
    key: string,
    body: Buffer | Readable,
    contentType: string,
    contentLength?: number
  ): Promise<void> {
    const client = this.getClient(opts)
    await client.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: key,
        Body: body,
        ContentLength: contentLength,
        ContentType: contentType,
      })
    )
  }

  async resolve(key: string): Promise<ResolvedObject | null> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    let stat: HeadObjectCommandOutput
    try {
      stat = await client.send(
        new HeadObjectCommand({
          Bucket: opts.bucket,
          Key: key,
        })
      )
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }

    return {
      stream: (opts) => this.openStream(key, opts?.start, opts?.end),
      size: Number(stat.ContentLength ?? 0),
      contentType: stat.ContentType ?? "application/octet-stream",
      lastModified: stat.LastModified ?? null,
    }
  }

  async mintUploadUrl(input: MintUploadUrlInput): Promise<UploadTicket> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const command = new PutObjectCommand({
      Bucket: opts.bucket,
      Key: input.key,
      ContentLength: input.maxBytes,
      ContentType: input.contentType,
    })
    const url = await getSignedUrl(client, command, {
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
        new DeleteObjectCommand({
          Bucket: opts.bucket,
          Key: key,
        })
      )
    } catch (err) {
      if (isMissing(err)) return
      throw err
    }
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    await fsp.mkdir(path.dirname(destPath), { recursive: true })
    await pipeline(
      this.openStream(key, undefined, undefined),
      createWriteStream(destPath)
    )
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    contentType: string
  ): Promise<{ size: number }> {
    const stat = await fsp.stat(localPath)
    const opts = this.getOptions()
    await this.putStream(
      opts,
      key,
      createReadStream(localPath),
      contentType,
      stat.size
    )
    return { size: stat.size }
  }

  async copy(input: {
    fromKey: string
    toKey: string
    contentType: string
  }): Promise<{ size: number }> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    try {
      await client.send(
        new CopyObjectCommand({
          Bucket: opts.bucket,
          Key: input.toKey,
          CopySource: `${opts.bucket}/${encodeCopySourceKey(input.fromKey)}`,
          ContentType: input.contentType,
          MetadataDirective: "REPLACE",
        })
      )
      const resolved = await this.resolve(input.toKey)
      if (!resolved) {
        throw new Error(
          `s3: copied object ${input.toKey} could not be resolved`
        )
      }
      return { size: resolved.size }
    } catch (err) {
      if (!isMissing(err)) throw err
    }

    const source = await this.resolve(input.fromKey)
    if (!source) {
      throw new Error(`s3: copy source ${input.fromKey} does not exist`)
    }
    await this.putStream(
      opts,
      input.toKey,
      source.stream(),
      input.contentType,
      source.size
    )
    return { size: source.size }
  }

  async mintDownloadUrl(
    key: string,
    input: MintDownloadUrlInput
  ): Promise<DownloadUrl | null> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const expiresIn = input.expiresInSec || opts.presignExpiresSec
    const command = new GetObjectCommand({
      Bucket: opts.bucket,
      Key: key,
      ResponseContentType: input.responseContentType,
      ResponseContentDisposition: input.responseContentDisposition,
      ResponseCacheControl: input.responseCacheControl,
    })
    const url = await getSignedUrl(client, command, { expiresIn })
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
        const range =
          start === undefined
            ? undefined
            : `bytes=${start}-${end === undefined ? "" : end}`
        const result = await client.send(
          new GetObjectCommand({
            Bucket: opts.bucket,
            Key: key,
            Range: range,
          })
        )
        if (!result.Body) {
          throw new Error(`s3: ${key} returned an empty body`)
        }
        const body = toNodeReadable(result.Body)
        body.on("error", (err) => pass.destroy(err))
        body.pipe(pass)
      } catch (err) {
        pass.destroy(err as Error)
      }
    })()
    return pass
  }
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) {
    return body
  }
  if (
    body instanceof ReadableStream ||
    (body && typeof (body as { getReader?: unknown }).getReader === "function")
  ) {
    return Readable.fromWeb(body as ReadableStream<Uint8Array>)
  }
  const withTransform = body as
    | { transformToWebStream?: () => ReadableStream<Uint8Array> }
    | undefined
  if (withTransform?.transformToWebStream) {
    return Readable.fromWeb(withTransform.transformToWebStream())
  }
  throw new Error("s3: unsupported response body stream")
}

function encodeCopySourceKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")
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
