import { readFile } from "node:fs/promises"

import { encode } from "blurhash"
import sharp from "sharp"

const MAX_SAMPLE_DIMENSION = 128

type ImageInput = {
  /** Local file path or http(s) URL. */
  source: string
  label?: string
  signal?: AbortSignal
}

type ImageDimensions = {
  width: number
  height: number
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
  const { x, y } = blurHashComponents(sample)
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
    const response = await fetch(source, { signal })
    if (!response.ok) {
      throw new Error(`${label}: fetch failed with status ${response.status}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }
  return readFile(source)
}

function blurHashComponents({ width, height }: ImageDimensions): {
  x: number
  y: number
} {
  const xCompF = Math.sqrt((16 * width) / height)
  const yCompF = (xCompF * height) / width
  return {
    x: clampComponent(Math.floor(xCompF) + 1),
    y: clampComponent(Math.floor(yCompF) + 1),
  }
}

function clampComponent(value: number): number {
  return Math.max(1, Math.min(9, value))
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new DOMException("BlurHash cancelled", "AbortError")
}
