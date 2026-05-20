import { AwsClient } from "aws4fetch"

import type { S3DriverOptions } from "./s3-driver"

export function encodeCopySourceKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")
}

export function objectUrl(opts: S3DriverOptions, key: string): URL {
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

export async function presignUrl(
  client: AwsClient,
  url: URL,
  input: {
    method: string
    expiresInSec: number
    headers?: HeadersInit
  }
): Promise<string> {
  url.searchParams.set("X-Amz-Expires", String(input.expiresInSec))
  const signed = await client.sign(
    new Request(url, { method: input.method, headers: input.headers }),
    { aws: { signQuery: true } }
  )
  return signed.url
}
