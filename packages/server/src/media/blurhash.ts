import { readFile } from "node:fs/promises"

import { blurHashComponents } from "@alloy/contracts/blurhash"
import { encode } from "blurhash"
import sharp from "sharp"

const MAX_SAMPLE_DIMENSION = 128
const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 10000
const REMOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

type ImageInput = {
  /** Local file path or http(s) URL. */
  source: string
  label?: string
  signal?: AbortSignal
}

export async function imageBlurHash({
  source,
  label = "image blurhash",
  signal,
}: ImageInput): Promise<string> {
  throwIfAborted(signal)
  const bytes = await loadImageBytes(source, label, signal)
  throwIfAborted(signal)

  const { data, info } = await sharp(bytes)
    .resize(MAX_SAMPLE_DIMENSION, MAX_SAMPLE_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
      fastShrinkOnLoad: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  throwIfAborted(signal)

  const sample = { width: info.width, height: info.height }
  const { x, y } = blurHashComponents(sample.width, sample.height)
  return encode(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    sample.width,
    sample.height,
    x,
    y,
  )
}

async function loadImageBytes(
  source: string,
  label: string,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      signal: boundedRemoteSignal(signal),
    })
    if (!response.ok) {
      throw new Error(`${label}: fetch failed with status ${response.status}`)
    }
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`${label}: expected image content type`)
    }
    const contentLength = response.headers.get("content-length")
    if (
      contentLength !== null &&
      Number(contentLength) > REMOTE_IMAGE_MAX_BYTES
    ) {
      throw new Error(`${label}: image exceeds byte limit`)
    }
    return Buffer.from(await readBoundedRemoteBody(response, label))
  }
  return readFile(source)
}

async function readBoundedRemoteBody(
  response: Response,
  label: string,
): Promise<ArrayBuffer> {
  const reader = response.body?.getReader()
  if (!reader) return response.arrayBuffer()

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > REMOTE_IMAGE_MAX_BYTES) {
        throw new Error(`${label}: image exceeds byte limit`)
      }
      chunks.push(value)
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined)
    throw err
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

function boundedRemoteSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REMOTE_IMAGE_FETCH_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new DOMException("BlurHash cancelled", "AbortError")
}
