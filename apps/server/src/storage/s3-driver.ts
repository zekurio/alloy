import { AwsClient } from "aws4fetch"

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
  private cachedClient: { cacheKey: string; client: AwsClient } | null = null

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

  private getClient(opts: S3DriverOptions): AwsClient {
    const accessKeyId = opts.accessKeyId ?? Deno.env.get("AWS_ACCESS_KEY_ID")
    const secretAccessKey =
      opts.secretAccessKey ?? Deno.env.get("AWS_SECRET_ACCESS_KEY")
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        "S3 storage requires accessKeyId and secretAccessKey, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY."
      )
    }

    const cacheKey = JSON.stringify({
      bucket: opts.bucket,
      region: opts.region,
      endpoint: opts.endpoint,
      accessKeyId,
      secretAccessKey,
      sessionToken: Deno.env.get("AWS_SESSION_TOKEN"),
      forcePathStyle: opts.forcePathStyle,
    })
    if (this.cachedClient?.cacheKey === cacheKey) {
      return this.cachedClient.client
    }
    const client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      sessionToken: Deno.env.get("AWS_SESSION_TOKEN"),
      service: "s3",
      region: opts.region,
      retries: 0,
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
      await this.putBuffer(opts, key, body, contentType)
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
    body: ReadableStream<Uint8Array>,
    contentType: string,
    contentLength?: number
  ): Promise<void> {
    const client = this.getClient(opts)
    const headers: Record<string, string> = {
      "Content-Type": contentType,
    }
    if (contentLength !== undefined) {
      headers["Content-Length"] = String(contentLength)
    }
    const res = await client.fetch(objectUrl(opts, key), {
      method: "PUT",
      headers,
      body,
    })
    await assertOk(res, `upload ${key}`)
  }

  private async putBuffer(
    opts: S3DriverOptions,
    key: string,
    body: Uint8Array,
    contentType: string
  ): Promise<void> {
    const client = this.getClient(opts)
    const res = await client.fetch(objectUrl(opts, key), {
      method: "PUT",
      headers: {
        "Content-Length": String(body.byteLength),
        "Content-Type": contentType,
      },
      body,
    })
    await assertOk(res, `upload ${key}`)
  }

  async resolve(key: string): Promise<ResolvedObject | null> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const stat = await client.fetch(objectUrl(opts, key), { method: "HEAD" })
    if (stat.status === 404) return null
    await assertOk(stat, `stat ${key}`)

    return {
      stream: (opts) => this.openStream(key, opts?.start, opts?.end),
      size: Number(stat.headers.get("Content-Length") ?? 0),
      contentType:
        stat.headers.get("Content-Type") ?? "application/octet-stream",
      lastModified: parseHttpDate(stat.headers.get("Last-Modified")),
    }
  }

  async mintUploadUrl(input: MintUploadUrlInput): Promise<UploadTicket> {
    const opts = this.getOptions()
    const client = this.getClient(opts)
    const url = await presignUrl(client, objectUrl(opts, input.key), {
      method: "PUT",
      expiresInSec: input.expiresInSec,
      headers: {
        "Content-Length": String(input.maxBytes),
        "Content-Type": input.contentType,
      },
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
    const res = await client.fetch(objectUrl(opts, key), { method: "DELETE" })
    if (res.status === 404) return
    await assertOk(res, `delete ${key}`)
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
    const copyRes = await client.fetch(objectUrl(opts, input.toKey), {
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
        "x-amz-copy-source": `${opts.bucket}/${encodeCopySourceKey(
          input.fromKey
        )}`,
        "x-amz-metadata-directive": "REPLACE",
      },
    })
    if (copyRes.ok) {
      const resolved = await this.resolve(input.toKey)
      if (!resolved) {
        throw new Error(
          `s3: copied object ${input.toKey} could not be resolved`
        )
      }
      return { size: resolved.size }
    }
    if (copyRes.status !== 404) await assertOk(copyRes, `copy ${input.fromKey}`)

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
    const url = objectUrl(opts, key)
    if (input.responseContentType) {
      url.searchParams.set("response-content-type", input.responseContentType)
    }
    if (input.responseContentDisposition) {
      url.searchParams.set(
        "response-content-disposition",
        input.responseContentDisposition
      )
    }
    if (input.responseCacheControl) {
      url.searchParams.set("response-cache-control", input.responseCacheControl)
    }
    const signedUrl = await presignUrl(client, url, {
      method: "GET",
      expiresInSec: expiresIn,
    })
    return {
      url: signedUrl,
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
        const result = await client.fetch(objectUrl(opts, key), {
          method: "GET",
          headers: range ? { Range: range } : undefined,
          signal: abortController.signal,
        })
        await assertOk(result, `read ${key}`)
        if (!result.body) {
          throw new Error(`s3: ${key} returned an empty body`)
        }
        reader = result.body.getReader()
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

function objectUrl(opts: S3DriverOptions, key: string): URL {
  const base = new URL(
    opts.endpoint ?? `https://s3.${opts.region}.amazonaws.com`
  )
  const encodedKey = encodeObjectKey(key)

  if (opts.forcePathStyle) {
    base.pathname = joinUrlPath(base.pathname, opts.bucket, encodedKey)
    return base
  }

  if (opts.endpoint) {
    base.hostname = `${opts.bucket}.${base.hostname}`
    base.pathname = joinUrlPath(base.pathname, encodedKey)
    return base
  }

  base.hostname = `${opts.bucket}.s3.${opts.region}.amazonaws.com`
  base.pathname = joinUrlPath(base.pathname, encodedKey)
  return base
}

function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")
}

function joinUrlPath(...parts: string[]): string {
  const joined = parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part.length > 0)
    .join("/")
  return `/${joined}`
}

async function presignUrl(
  client: AwsClient,
  url: URL,
  input: {
    method: string
    expiresInSec: number
    headers?: RequestInit["headers"]
  }
): Promise<string> {
  url.searchParams.set("X-Amz-Expires", String(input.expiresInSec))
  const signed = await client.sign(url, {
    method: input.method,
    headers: input.headers,
    aws: { signQuery: true },
  })
  return signed.url
}

async function assertOk(res: Response, operation: string): Promise<void> {
  if (res.ok) return
  const detail = await res.text().catch(() => "")
  throw new Error(
    `s3: ${operation} failed with ${res.status} ${res.statusText}${
      detail ? `: ${detail}` : ""
    }`
  )
}

function parseHttpDate(value: string | null): Date | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time)
}
