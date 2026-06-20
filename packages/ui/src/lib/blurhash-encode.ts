import { blurHashComponents } from "@alloy/contracts/blurhash"
import { encode } from "blurhash"

const MAX_SAMPLE_DIMENSION = 128

export function canvasBlurHash(canvas: HTMLCanvasElement): string | null {
  const sourceWidth = canvas.width
  const sourceHeight = canvas.height
  if (sourceWidth <= 0 || sourceHeight <= 0) return null

  const scale = Math.min(
    1,
    MAX_SAMPLE_DIMENSION / Math.max(sourceWidth, sourceHeight),
  )
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const sample = scale < 1 ? drawSampleCanvas(canvas, width, height) : canvas
  const context = sample.getContext("2d", { willReadFrequently: true })
  if (!context) return null

  const imageData = context.getImageData(0, 0, width, height)
  const { x, y } = blurHashComponents(width, height)
  return encode(imageData.data, width, height, x, y)
}

function drawSampleCanvas(
  source: HTMLCanvasElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) return canvas
  context.drawImage(source, 0, 0, width, height)
  return canvas
}
