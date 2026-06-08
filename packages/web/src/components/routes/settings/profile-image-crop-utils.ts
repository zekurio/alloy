export type CropMode = "avatar" | "banner"

type CropConfig = {
  aspect: number
  label: string
  outputHeight: number
  outputWidth: number
}

export const CROP_CONFIG: Record<CropMode, CropConfig> = {
  avatar: {
    aspect: 1,
    label: "Edit avatar",
    outputHeight: 512,
    outputWidth: 512,
  },
  banner: {
    aspect: 4,
    label: "Edit banner",
    outputHeight: 375,
    outputWidth: 1500,
  },
}

const PAN_AXIS_EPSILON_PX = 0.5
export const DEFAULT_PREVIEW_ZOOM = 1
export const MAX_PREVIEW_ZOOM = 4

export type LoadedImage = {
  height: number
  src: string
  width: number
}

export type Point = {
  x: number
  y: number
}

export type DragState = {
  origin: Point
  pointerId: number
  startOffset: Point
}

type CropFrame = {
  height: number
  stageHeight: number
  stageWidth: number
  width: number
  x: number
  y: number
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function pointsEqual(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y
}

export function clampImageOffset(
  next: Point,
  cropFrame: CropFrame,
  imageBox: { height: number; width: number } | null,
) {
  if (!imageBox) return { x: 0, y: 0 }

  const stageCenterX = cropFrame.stageWidth / 2
  const stageCenterY = cropFrame.stageHeight / 2
  const minX = cropFrame.x + cropFrame.width - stageCenterX - imageBox.width / 2
  const maxX = cropFrame.x - stageCenterX + imageBox.width / 2
  const minY =
    cropFrame.y + cropFrame.height - stageCenterY - imageBox.height / 2
  const maxY = cropFrame.y - stageCenterY + imageBox.height / 2

  return {
    x: clampRange(next.x, minX, maxX),
    y: clampRange(next.y, minY, maxY),
  }
}

function clampRange(value: number, min: number, max: number) {
  if (min > max) return (min + max) / 2
  if (max - min <= PAN_AXIS_EPSILON_PX) return (min + max) / 2
  return clamp(value, min, max)
}

export function getMinimumZoom(
  mode: CropMode,
  containedImageBox: { height: number; width: number } | null,
  cropFrame: CropFrame,
) {
  if (mode !== "avatar" || !containedImageBox) {
    return DEFAULT_PREVIEW_ZOOM
  }

  return clamp(
    Math.max(
      cropFrame.width / containedImageBox.width,
      cropFrame.height / containedImageBox.height,
    ),
    0,
    DEFAULT_PREVIEW_ZOOM,
  )
}

export function getLiveCropGeometry(
  image: LoadedImage | null,
  stage: { height: number; width: number },
  config: CropConfig,
  mode: CropMode,
  zoom: number,
) {
  const containedImageBox = image ? getImageBox(image, stage, 1) : null
  return {
    cropFrame: getCropFrame(stage, config.aspect, mode, containedImageBox),
    imageBox: image ? getImageBox(image, stage, zoom) : null,
  }
}

export function fallbackStageSize(mode: CropMode) {
  return mode === "avatar"
    ? { height: 420, width: 560 }
    : { height: 315, width: 560 }
}

export function getImageBox(
  image: Pick<LoadedImage, "height" | "width">,
  stage: { height: number; width: number },
  zoom: number,
) {
  const baseScale = Math.min(
    stage.width / image.width,
    stage.height / image.height,
  )
  return {
    height: image.height * baseScale * zoom,
    width: image.width * baseScale * zoom,
  }
}

export function getImagePlacement(
  stage: { height: number; width: number },
  imageBox: { height: number; width: number },
  offset: Point,
) {
  return {
    height: imageBox.height,
    left: (stage.width - imageBox.width) / 2 + offset.x,
    top: (stage.height - imageBox.height) / 2 + offset.y,
    width: imageBox.width,
  }
}

export function getCropFrame(
  stage: { height: number; width: number },
  aspect: number,
  mode: CropMode,
  containedImageBox: { height: number; width: number } | null,
): CropFrame {
  const preferredMaxWidth =
    mode === "avatar" ? stage.height * 0.78 : stage.width
  const preferredMaxHeight =
    mode === "avatar" ? stage.height * 0.78 : stage.height * 0.54
  const maxWidth = Math.min(
    preferredMaxWidth,
    containedImageBox?.width ?? preferredMaxWidth,
  )
  const maxHeight = Math.min(
    preferredMaxHeight,
    containedImageBox?.height ?? preferredMaxHeight,
  )
  let width = Math.min(stage.width, maxWidth)
  let height = width / aspect

  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }

  return {
    height,
    stageHeight: stage.height,
    stageWidth: stage.width,
    width,
    x: (stage.width - width) / 2,
    y: (stage.height - height) / 2,
  }
}

export function isCropCovered(
  cropFrame: CropFrame,
  image: { height: number; left: number; top: number; width: number },
) {
  const imageRight = image.left + image.width
  const imageBottom = image.top + image.height
  const cropRight = cropFrame.x + cropFrame.width
  const cropBottom = cropFrame.y + cropFrame.height

  return (
    image.left <= cropFrame.x &&
    image.top <= cropFrame.y &&
    imageRight >= cropRight &&
    imageBottom >= cropBottom
  )
}

export function readElementSize(node: HTMLElement | null) {
  if (!node) return null

  if (node.clientWidth <= 0 || node.clientHeight <= 0) return null
  return { height: node.clientHeight, width: node.clientWidth }
}

export function preferredOutputType(type: string) {
  return type === "image/png" || type === "image/webp" ? type : "image/jpeg"
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
      } else {
        reject(new Error("Couldn't read image"))
      }
    }
    reader.onerror = () => reject(new Error("Couldn't read image"))
    reader.readAsDataURL(file)
  })
}

export async function readImageDimensions(file: File) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file)
      const dimensions = { height: bitmap.height, width: bitmap.width }
      bitmap.close()
      return dimensions
    } catch {
      // Fall through to the regular image decoder.
    }
  }

  const image = await loadImage(await readFileAsDataUrl(file))
  return { height: image.naturalHeight, width: image.naturalWidth }
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.decoding = "async"
  image.src = src

  if (image.decode) {
    await image.decode()
    return image
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error("Couldn't load image"))
  })
  return image
}

export async function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, 0.92)
  })

  if (!blob) throw new Error("Couldn't crop image")
  return blob
}
