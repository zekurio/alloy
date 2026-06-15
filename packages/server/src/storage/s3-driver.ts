import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat } from "node:fs/promises"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { ReadableStream as NodeReadableStream } from "node:stream/web"

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type HeadObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { dirname } from "../runtime/path"
import type {
  MintDownloadUrlInput,
  MintUploadUrlInput,
  ResolvedObject,
  StorageDriver,
  UploadTicket,
} from "./driver"
import { normalizeObjectPath } from "./object-path"

interface S3StorageDriverOptions {
  bucket: string
  region: string
  endpoint: string | null
  forcePathStyle: boolean
  prefix: string
  credentials: {
    accessKeyId: string
    secretAccessKey: string
  }
}

export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client
  private readonly prefix: string

  constructor(private readonly opts: S3StorageDriverOptions) {
    if (!opts.bucket.trim()) {
      throw new Error("S3 storage requires a bucket")
    }
    this.prefix = normalizeObjectPath(opts.prefix)
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint ?? undefined,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.credentials,
    })
  }

  async put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
  ): Promise<{ size: number }> {
    let size = body instanceof Uint8Array ? body.byteLength : 0
    const uploadBody =
      body instanceof Uint8Array
        ? body
        : fromWebStream(body).pipe(
            new Transform({
              transform(chunk: Buffer, _encoding, callback) {
                size += chunk.byteLength
                callback(null, chunk)
              },
            }),
          )

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: this.fullKey(key),
        Body: uploadBody,
        ContentType: contentType,
      }),
    )
    return { size }
  }

  async resolve(key: string): Promise<ResolvedObject | null> {
    const fullKey = this.fullKey(key)
    let head: HeadObjectCommandOutput
    try {
      head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.opts.bucket,
          Key: fullKey,
        }),
      )
    } catch (err) {
      if (isS3NotFound(err)) return null
      throw err
    }

    const size = head.ContentLength
    if (size === undefined || size < 0) {
      throw new Error(`S3 object is missing Content-Length: ${fullKey}`)
    }

    return {
      size,
      contentType: head.ContentType ?? "application/octet-stream",
      lastModified: head.LastModified ?? null,
      stream: (opts) => this.getObjectStream(fullKey, opts),
    }
  }

  async mintUploadUrl(input: MintUploadUrlInput): Promise<UploadTicket> {
    const expiresAt = Math.floor(Date.now() / 1000) + input.expiresInSec
    const command = new PutObjectCommand({
      Bucket: this.opts.bucket,
      Key: this.fullKey(input.key),
      ContentType: input.contentType,
    })

    return {
      uploadUrl: await getSignedUrl(this.client, command, {
        expiresIn: input.expiresInSec,
      }),
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt,
    }
  }

  async mintDownloadUrl(input: MintDownloadUrlInput): Promise<string | null> {
    const command = new GetObjectCommand({
      Bucket: this.opts.bucket,
      Key: this.fullKey(input.key),
      ResponseContentType: input.contentType,
      ResponseContentDisposition: input.contentDisposition,
    })
    return getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSec,
    })
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.opts.bucket,
        Key: this.fullKey(key),
      }),
    )
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const tmpPath = `${destPath}.${crypto.randomUUID()}.tmp`
    await mkdir(dirname(destPath), { recursive: true })
    await rm(tmpPath, { force: true }).catch(() => undefined)
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.opts.bucket,
          Key: this.fullKey(key),
        }),
      )
      await pipeline(
        bodyToNodeStream(response.Body),
        createWriteStream(tmpPath),
      )
      await rename(tmpPath, destPath)
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => undefined)
      throw err
    }
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    contentType: string,
  ): Promise<{ size: number }> {
    const stats = await stat(localPath)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: this.fullKey(key),
        Body: createReadStream(localPath),
        ContentLength: stats.size,
        ContentType: contentType,
      }),
    )
    return { size: stats.size }
  }

  async copy(input: {
    fromKey: string
    toKey: string
    contentType: string
  }): Promise<{ size: number }> {
    const toKey = this.fullKey(input.toKey)
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.opts.bucket,
        Key: toKey,
        CopySource: copySource(this.opts.bucket, this.fullKey(input.fromKey)),
        ContentType: input.contentType,
        MetadataDirective: "REPLACE",
      }),
    )
    const head = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.opts.bucket,
        Key: toKey,
      }),
    )
    return { size: head.ContentLength ?? 0 }
  }

  private fullKey(key: string): string {
    const normalized = normalizeObjectPath(key)
    if (!normalized) throw new Error("Storage key is empty")
    return this.prefix ? `${this.prefix}/${normalized}` : normalized
  }

  private getObjectStream(
    key: string,
    opts: { start?: number; end?: number } | undefined,
  ): ReadableStream<Uint8Array> {
    return Readable.toWeb(
      Readable.from(this.getObjectChunks(key, opts)),
    ) as ReadableStream<Uint8Array>
  }

  private async *getObjectChunks(
    key: string,
    opts: { start?: number; end?: number } | undefined,
  ): AsyncGenerator<Uint8Array> {
    const range =
      opts?.start !== undefined
        ? `bytes=${opts.start}-${opts.end ?? ""}`
        : undefined
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Range: range,
      }),
    )
    for await (const chunk of bodyToNodeStream(response.Body)) {
      yield chunk instanceof Uint8Array ? chunk : Buffer.from(chunk)
    }
  }
}

function bodyToNodeStream(body: unknown): Readable {
  if (body instanceof Readable) return body
  if (body instanceof NodeReadableStream) return fromWebStream(body)
  const transformed = body as {
    transformToWebStream?: () => NodeReadableStream<Uint8Array>
  } | null
  if (transformed && typeof transformed.transformToWebStream === "function") {
    return fromWebStream(transformed.transformToWebStream())
  }
  throw new Error("S3 response body is not readable")
}

function fromWebStream(
  stream: ReadableStream<Uint8Array> | NodeReadableStream<Uint8Array>,
): Readable {
  return Readable.fromWeb(stream as NodeReadableStream<Uint8Array>)
}

function copySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`
}

function isS3NotFound(err: unknown): boolean {
  const maybe = err as {
    name?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    maybe.name === "NoSuchKey" ||
    maybe.name === "NotFound" ||
    maybe.$metadata?.httpStatusCode === 404
  )
}
