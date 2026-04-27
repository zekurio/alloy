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

export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly presignExpiresSec: number

  constructor(opts: S3DriverOptions) {
    this.bucket = opts.bucket
    this.presignExpiresSec = opts.presignExpiresSec
    // If access keys aren't provided we let the SDK's default credential
    // chain take over — supports instance roles, workload identity, etc.
    const credentials =
      opts.accessKeyId && opts.secretAccessKey
        ? {
            accessKeyId: opts.accessKeyId,
            secretAccessKey: opts.secretAccessKey,
          }
        : undefined
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials,
      // R2 rejects the SDK's default CRC32 on presigned PUTs.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    })
  }

  async put(
    key: string,
    body: Buffer | Readable,
    contentType: string
  ): Promise<{ size: number }> {
    if (Buffer.isBuffer(body)) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
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
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: Readable.from(counter(body)),
        ContentType: contentType,
      },
    })
    await upload.done()
    return { size }
  }

  async resolve(key: string): Promise<ResolvedObject | null> {
    let head
    try {
      head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
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
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentLength: input.maxBytes,
      ContentType: input.contentType,
    })
    const url = await getSignedUrl(this.client, cmd, {
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
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
      )
    } catch (err) {
      if (isMissing(err)) return
      throw err
    }
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    await fsp.mkdir(path.dirname(destPath), { recursive: true })
    const resp = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
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
    const stat = await fsp.stat(localPath)
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
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
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: input.toKey,
        CopySource: `${this.bucket}/${encodeS3CopySourceKey(input.fromKey)}`,
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
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: input.responseContentType,
      ResponseContentDisposition: input.responseContentDisposition,
      ResponseCacheControl: input.responseCacheControl,
    })
    const expiresIn = input.expiresInSec || this.presignExpiresSec
    const url = await getSignedUrl(this.client, cmd, { expiresIn })
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
    const pass = new PassThrough()
    const range =
      start !== undefined
        ? `bytes=${start}-${end !== undefined ? end : ""}`
        : undefined
    void (async () => {
      try {
        const resp = await this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
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
