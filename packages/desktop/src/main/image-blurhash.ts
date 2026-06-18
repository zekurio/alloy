import { createLogger } from "@alloy/logging"
import { encode } from "blurhash"
import { nativeImage } from "electron"

const logger = createLogger("media")

const MAX_SAMPLE_DIMENSION = 128

/**
 * Computes the BlurHash of a local image file (capture thumbnails and
 * posters). Decoding goes through Electron's `nativeImage`, so no external
 * binary is needed; the image is downscaled before encoding because BlurHash
 * quality saturates well below 128px.
 *
 * Mirrors the server's `imageBlurHash` component selection so locally
 * generated hashes look the same as server-generated ones.
 */
export function imageFileBlurHash(path: string): string | null {
  try {
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) return null

    const size = image.getSize()
    if (size.width <= 0 || size.height <= 0) return null

    const scale = Math.min(
      1,
      MAX_SAMPLE_DIMENSION / Math.max(size.width, size.height),
    )
    const sample =
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "good",
          })
        : image
    const { width, height } = sample.getSize()

    // nativeImage bitmaps are BGRA; blurhash expects RGBA.
    const bitmap = sample.toBitmap()
    if (bitmap.length !== width * height * 4) return null
    const pixels = new Uint8ClampedArray(bitmap.length)
    for (let i = 0; i < bitmap.length; i += 4) {
      pixels[i] = bitmap[i + 2]
      pixels[i + 1] = bitmap[i + 1]
      pixels[i + 2] = bitmap[i]
      pixels[i + 3] = bitmap[i + 3]
    }

    const { x, y } = blurHashComponents(width, height)
    return encode(pixels, width, height, x, y)
  } catch (cause) {
    logger.warn("failed to compute image blurhash:", cause)
    return null
  }
}

function blurHashComponents(
  width: number,
  height: number,
): { x: number; y: number } {
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
