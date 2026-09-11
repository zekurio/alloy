import { SCREENSHOT_MAX_PIXELS } from "@alloy/contracts"
import { t } from "@alloy/i18n"

export type ScreenshotEdit = {
  rotation: number
  flipX: boolean
  flipY: boolean
  crop: { x: number; y: number; width: number; height: number }
}
export const DEFAULT_SCREENSHOT_EDIT: ScreenshotEdit = {
  rotation: 0,
  flipX: false,
  flipY: false,
  crop: { x: 0, y: 0, width: 1, height: 1 },
}

/** Fit a pixel aspect ratio inside a normalized crop, retaining its center. */
export function fitScreenshotCrop(
  crop: ScreenshotEdit["crop"],
  dimensions: { width: number; height: number },
  ratio: number | null,
): ScreenshotEdit["crop"] {
  if (ratio === null) return { ...crop }
  const normalizedRatio = (ratio * dimensions.height) / dimensions.width
  const width = Math.min(crop.width, crop.height * normalizedRatio)
  const height = width / normalizedRatio
  return {
    x: crop.x + (crop.width - width) / 2,
    y: crop.y + (crop.height - height) / 2,
    width,
    height,
  }
}

/** Move a normalized crop without letting it leave the image. */
export function moveScreenshotCrop(
  crop: ScreenshotEdit["crop"],
  dx: number,
  dy: number,
): ScreenshotEdit["crop"] {
  return {
    ...crop,
    x: Math.max(0, Math.min(1 - crop.width, crop.x + dx)),
    y: Math.max(0, Math.min(1 - crop.height, crop.y + dy)),
  }
}

/** Return whether a pointer can move an existing crop at this position. */
export function canMoveScreenshotCropAt(
  crop: ScreenshotEdit["crop"],
  x: number,
  y: number,
): boolean {
  const isFullImage =
    crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1
  return (
    !isFullImage &&
    x >= crop.x &&
    x <= crop.x + crop.width &&
    y >= crop.y &&
    y <= crop.y + crop.height
  )
}

export function screenshotDimensions(
  width: number,
  height: number,
  rotation: number,
) {
  const angle = (rotation * Math.PI) / 180
  return {
    width: Math.ceil(
      Math.abs(width * Math.cos(angle)) +
        Math.abs(height * Math.sin(angle)) -
        1e-8,
    ),
    height: Math.ceil(
      Math.abs(width * Math.sin(angle)) +
        Math.abs(height * Math.cos(angle)) -
        1e-8,
    ),
  }
}

export function drawScreenshot(
  canvas: HTMLCanvasElement,
  image: ImageBitmap,
  edit: ScreenshotEdit,
  maxDimension = Infinity,
) {
  const dimensions = screenshotDimensions(
    image.width,
    image.height,
    edit.rotation,
  )
  const scale = Math.min(
    1,
    maxDimension / Math.max(dimensions.width, dimensions.height),
  )
  canvas.width = Math.max(1, Math.round(dimensions.width * scale))
  canvas.height = Math.max(1, Math.round(dimensions.height * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error(t("Image editing is unavailable"))
  context.translate(canvas.width / 2, canvas.height / 2)
  context.scale(edit.flipX ? -1 : 1, edit.flipY ? -1 : 1)
  context.rotate((edit.rotation * Math.PI) / 180)
  context.scale(scale, scale)
  context.drawImage(image, -image.width / 2, -image.height / 2)
}

/** Preview and export share the same transform; crop coordinates refer to the rotated image. */
export async function exportScreenshot(
  file: File,
  edit: ScreenshotEdit,
): Promise<File> {
  const image = await createImageBitmap(file)
  try {
    const dimensions = screenshotDimensions(
      image.width,
      image.height,
      edit.rotation,
    )
    if (dimensions.width * dimensions.height > SCREENSHOT_MAX_PIXELS)
      throw new Error(t("Rotated image dimensions are too large"))
    const canvas = document.createElement("canvas")
    drawScreenshot(canvas, image, edit)
    const output = document.createElement("canvas")
    const x = Math.round(edit.crop.x * canvas.width)
    const y = Math.round(edit.crop.y * canvas.height)
    output.width = Math.max(
      1,
      Math.min(canvas.width - x, Math.round(edit.crop.width * canvas.width)),
    )
    output.height = Math.max(
      1,
      Math.min(canvas.height - y, Math.round(edit.crop.height * canvas.height)),
    )
    const context = output.getContext("2d")
    if (!context) throw new Error(t("Image editing is unavailable"))
    context.drawImage(
      canvas,
      x,
      y,
      output.width,
      output.height,
      0,
      0,
      output.width,
      output.height,
    )
    const blob = await new Promise<Blob | null>((resolve) =>
      output.toBlob(resolve, "image/png"),
    )
    canvas.width = canvas.height = 0
    output.width = output.height = 0
    if (!blob) throw new Error(t("Could not export screenshot"))
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", {
      type: "image/png",
    })
  } finally {
    image.close()
  }
}
