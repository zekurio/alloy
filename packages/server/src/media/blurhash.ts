import { readFile } from "node:fs/promises"

import { blurHashComponents } from "@alloy/contracts/blurhash"
import { fetchRemoteImage } from "@alloy/server/media/remote-image"
import { encode } from "blurhash"
import sharp from "sharp"

const MAX_SAMPLE_DIMENSION = 128

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
  const hash = await imageBlurHashFromBytes(bytes)
  throwIfAborted(signal)
  return hash
}

/** Compute a BlurHash from already-loaded image bytes (e.g. an upload). */
export async function imageBlurHashFromBytes(
  bytes: Buffer | Uint8Array,
): Promise<string> {
  const { data, info } = await sharp(bytes)
    .resize(MAX_SAMPLE_DIMENSION, MAX_SAMPLE_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
      fastShrinkOnLoad: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { x, y } = blurHashComponents(info.width, info.height)
  return encode(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
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
    return (await fetchRemoteImage(source, label, signal)).bytes
  }
  return readFile(source)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new DOMException("BlurHash cancelled", "AbortError")
}
