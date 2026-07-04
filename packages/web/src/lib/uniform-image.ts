import {
  UNIFORM_IMAGE_CHANNEL_RANGE_THRESHOLD,
  UNIFORM_IMAGE_SAMPLE_MAX_DIMENSION,
  UNIFORM_IMAGE_VARIANCE_THRESHOLD,
} from "@alloy/contracts"

interface ImageDataLike {
  readonly data: ArrayLike<number>
  readonly width: number
  readonly height: number
}

export function isUniformImageData(imageData: ImageDataLike): boolean {
  const pixelCount = Math.min(
    imageData.width * imageData.height,
    Math.floor(imageData.data.length / 4),
  )
  if (pixelCount <= 1) return true

  let minR = 255
  let minG = 255
  let minB = 255
  let maxR = 0
  let maxG = 0
  let maxB = 0
  let lumaSum = 0
  let lumaSquares = 0

  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const offset = pixel * 4
    const r = imageData.data[offset] ?? 0
    const g = imageData.data[offset + 1] ?? 0
    const b = imageData.data[offset + 2] ?? 0
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

    minR = Math.min(minR, r)
    minG = Math.min(minG, g)
    minB = Math.min(minB, b)
    maxR = Math.max(maxR, r)
    maxG = Math.max(maxG, g)
    maxB = Math.max(maxB, b)
    lumaSum += luma
    lumaSquares += luma * luma
  }

  const mean = lumaSum / pixelCount
  const variance = lumaSquares / pixelCount - mean * mean
  return (
    maxR - minR <= UNIFORM_IMAGE_CHANNEL_RANGE_THRESHOLD &&
    maxG - minG <= UNIFORM_IMAGE_CHANNEL_RANGE_THRESHOLD &&
    maxB - minB <= UNIFORM_IMAGE_CHANNEL_RANGE_THRESHOLD &&
    variance <= UNIFORM_IMAGE_VARIANCE_THRESHOLD
  )
}

export function isUniformCanvasImage(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  if (!sourceWidth || !sourceHeight) return true

  const scale = Math.min(
    1,
    UNIFORM_IMAGE_SAMPLE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight),
  )
  const sampleCanvas = document.createElement("canvas")
  sampleCanvas.width = Math.max(1, Math.round(sourceWidth * scale))
  sampleCanvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return false

  try {
    ctx.drawImage(source, 0, 0, sampleCanvas.width, sampleCanvas.height)
    return isUniformImageData(
      ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height),
    )
  } catch {
    return false
  }
}
