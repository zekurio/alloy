import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { dirname } from "../runtime/path"
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
    body: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string
  ): Promise<{ size: number }> {
    const opts = this.getOptions()
    if (body instanceof Uint8Array) {
      await this.putStream(opts, key, body, contentType, body.byteLength)
      return { size: body.byteLength }
    }

    let size = 0
    const counted = body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.byteLength
          controller.enqueue(chunk)
        },
      })
    )
    await this.putStream(opts, key, counted, contentType)
    return { size }
  }

  private async putStream(
    opts: S3DriverOptions,
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
    contentLength?: number
  ): Promise<void> {
    const client = this.getClient(opts)
    await client.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: key,
        Body: body as never,
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
    await Deno.mkdir(dirname(destPath), { recursive: true })
    const file = await Deno.open(destPath, {
      create: true,
      write: true,
      truncate: true,
    })
    await this.openStream(key, undefined, undefined).pipeTo(file.writable)
  }

  async uploadFromFile(
    localPath: string,
    key: string,
    contentType: string
  ): Promise<{ size: number }> {
    const stat = await Deno.stat(localPath)
    const opts = this.getOptions()
    const file = await Deno.open(localPath, { read: true })
    await this.putStream(opts, key, file.readable, contentType, stat.size)
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
  ): ReadableStream<Uint8Array> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let opening: Promise<ReadableStreamDefaultReader<Uint8Array>> | null = null
    let done = false
    const abortController = new AbortController()

    const openReader = async () => {
      if (reader) return reader
      if (opening) return opening
      opening = (async () => {
        const range =
          start === undefined
            ? undefined
            : `bytes=${start}-${end === undefined ? "" : end}`
        const result = await client.send(
          new GetObjectCommand({
            Bucket: opts.bucket,
            Key: key,
            Range: range,
          }),
          { abortSignal: abortController.signal }
        )
        if (!result.Body) {
          throw new Error(`s3: ${key} returned an empty body`)
        }
        reader = toWebReadable(result.Body).getReader()
        if (done) {
          await reader.cancel()
          reader.releaseLock()
          reader = null
          throw new DOMException("Stream canceled", "AbortError")
        }
        return reader
      })()
      return opening
    }

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (done) return
        try {
          const activeReader = await openReader()
          const next = await activeReader.read()
          if (next.done) {
            done = true
            activeReader.releaseLock()
            controller.close()
            return
          }
          controller.enqueue(next.value)
        } catch (err) {
          done = true
          if (reader) {
            reader.releaseLock()
            reader = null
          }
          controller.error(err)
        }
      },
      async cancel(reason) {
        done = true
        abortController.abort(reason)
        const activeReader = reader
        reader = null
        if (activeReader) {
          try {
            await activeReader.cancel(reason)
          } finally {
            activeReader.releaseLock()
          }
        }
      },
    })
  }
}

function toWebReadable(body: unknown): ReadableStream<Uint8Array> {
  if (
    body instanceof ReadableStream ||
    (body && typeof (body as { getReader?: unknown }).getReader === "function")
  ) {
    return body as ReadableStream<Uint8Array>
  }
  const withTransform = body as
    | { transformToWebStream?: () => ReadableStream<Uint8Array> }
    | undefined
  if (withTransform?.transformToWebStream) {
    return withTransform.transformToWebStream()
  }
  if (isAsyncIterable(body)) return readableFromAsyncIterable(body)
  throw new Error("s3: unsupported response body stream")
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    value != null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] === "function"
  )
}

function readableFromAsyncIterable(
  iterable: AsyncIterable<Uint8Array>
): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) {
        controller.close()
        return
      }
      controller.enqueue(next.value)
    },
    async cancel() {
      await iterator.return?.()
    },
  })
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
