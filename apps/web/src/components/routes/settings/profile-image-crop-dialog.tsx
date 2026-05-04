import * as React from "react"
import { ImageIcon, Minus, Plus } from "lucide-react"

import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogContent,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { Slider } from "@workspace/ui/components/slider"
import { toast } from "@workspace/ui/lib/toast"
import { cn } from "@workspace/ui/lib/utils"

type CropMode = "avatar" | "banner"

type CropConfig = {
  aspect: number
  label: string
  outputHeight: number
  outputWidth: number
}

const CROP_CONFIG: Record<CropMode, CropConfig> = {
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
const DEFAULT_PREVIEW_ZOOM = 1

type LoadedImage = {
  height: number
  src: string
  width: number
}

type Point = {
  x: number
  y: number
}

type DragState = {
  origin: Point
  pointerId: number
  startOffset: Point
}

export function ProfileImageCropDialog({
  file,
  mode,
  open,
  applying,
  onApply,
  onApplyingChange,
  onOpenChange,
}: {
  file: File | null
  mode: CropMode
  open: boolean
  applying: boolean
  onApply: (blob: Blob) => Promise<void>
  onApplyingChange?: (applying: boolean) => void
  onOpenChange: (open: boolean) => void
}) {
  const config = CROP_CONFIG[mode]
  const stageRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const [stageNode, setStageNode] = React.useState<HTMLDivElement | null>(null)
  const [loadedImage, setLoadedImage] = React.useState<LoadedImage | null>(null)
  const [stageSize, setStageSize] = React.useState({ height: 0, width: 0 })
  const [offset, setOffset] = React.useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = React.useState(1)
  const [cropPending, setCropPending] = React.useState(false)
  const stageReady = stageSize.width > 0 && stageSize.height > 0
  const cropReady = !!loadedImage && stageReady
  const controlsDisabled = !cropReady || applying || cropPending
  const effectiveStageSize = React.useMemo(
    () => (stageReady ? stageSize : fallbackStageSize(mode)),
    [mode, stageSize]
  )
  const containedImageBox = React.useMemo(() => {
    if (!loadedImage) return null
    return getImageBox(loadedImage, effectiveStageSize, 1)
  }, [effectiveStageSize, loadedImage])
  const cropFrame = React.useMemo(
    () =>
      getCropFrame(effectiveStageSize, config.aspect, mode, containedImageBox),
    [config.aspect, containedImageBox, effectiveStageSize, mode]
  )

  React.useEffect(() => {
    onApplyingChange?.(cropPending)
  }, [cropPending, onApplyingChange])

  React.useEffect(() => {
    if (!file || !open) {
      setLoadedImage(null)
      setStageSize({ height: 0, width: 0 })
      setCropPending(false)
      return
    }

    let active = true
    setLoadedImage(null)
    setStageSize({ height: 0, width: 0 })
    setCropPending(false)

    const load = async () => {
      const [src, dimensions] = await Promise.all([
        readFileAsDataUrl(file),
        readImageDimensions(file),
      ])

      if (!active) return

      setLoadedImage({
        height: dimensions.height,
        src,
        width: dimensions.width,
      })
      setOffset({ x: 0, y: 0 })
      setZoom(DEFAULT_PREVIEW_ZOOM)
    }

    load().catch(() => {
      if (active) {
        setLoadedImage(null)
      }
    })

    return () => {
      active = false
    }
  }, [file, open])

  React.useLayoutEffect(() => {
    if (!open) return

    const node = stageNode
    if (!node) return

    const update = () => {
      const nextSize = readElementSize(node)
      if (!nextSize) return

      setStageSize((current) => {
        if (
          current.height === nextSize.height &&
          current.width === nextSize.width
        ) {
          return current
        }

        return nextSize
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [open, mode, stageNode])

  const imageBox = React.useMemo(() => {
    if (!loadedImage) {
      return null
    }

    return getImageBox(loadedImage, effectiveStageSize, zoom)
  }, [effectiveStageSize, loadedImage, zoom])

  const clampOffset = React.useCallback(
    (next: Point) => {
      if (!imageBox) return { x: 0, y: 0 }

      return clampImageOffset(next, cropFrame, imageBox)
    },
    [cropFrame, imageBox]
  )

  React.useEffect(() => {
    setOffset((current) => {
      const next = clampOffset(current)
      return pointsEqual(current, next) ? current : next
    })
  }, [clampOffset, zoom])

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!cropReady || applying) return

    updateStageSizeFromDom()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      origin: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      startOffset: offset,
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const liveStageSize = updateStageSizeFromDom() ?? effectiveStageSize
    const liveContainedImageBox = loadedImage
      ? getImageBox(loadedImage, liveStageSize, 1)
      : null
    const liveCropFrame = getCropFrame(
      liveStageSize,
      config.aspect,
      mode,
      liveContainedImageBox
    )
    const liveImageBox = loadedImage
      ? getImageBox(loadedImage, liveStageSize, zoom)
      : null
    setOffset(
      clampImageOffset(
        {
          x: drag.startOffset.x + event.clientX - drag.origin.x,
          y: drag.startOffset.y + event.clientY - drag.origin.y,
        },
        liveCropFrame,
        liveImageBox
      )
    )
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  async function handleApply() {
    if (!file || !cropReady || cropPending) return

    setCropPending(true)
    try {
      const image = await loadImage(loadedImage.src)
      const renderedStageSize = readElementSize(stageRef.current) ?? stageSize
      if (renderedStageSize.width <= 0 || renderedStageSize.height <= 0) return

      const renderedContainedImageBox = getImageBox(
        loadedImage,
        renderedStageSize,
        1
      )
      const renderedCropFrame = getCropFrame(
        renderedStageSize,
        config.aspect,
        mode,
        renderedContainedImageBox
      )
      const renderedImageBox = getImageBox(loadedImage, renderedStageSize, zoom)
      const imageLeft =
        (renderedStageSize.width - renderedImageBox.width) / 2 + offset.x
      const imageTop =
        (renderedStageSize.height - renderedImageBox.height) / 2 + offset.y
      const cropLeft = renderedCropFrame.x - imageLeft
      const cropTop = renderedCropFrame.y - imageTop
      const scaleX = image.naturalWidth / renderedImageBox.width
      const scaleY = image.naturalHeight / renderedImageBox.height

      const canvas = document.createElement("canvas")
      canvas.width = config.outputWidth
      canvas.height = config.outputHeight

      const context = canvas.getContext("2d")
      if (!context) throw new Error("Image cropping is not supported")

      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = "high"
      context.drawImage(
        image,
        cropLeft * scaleX,
        cropTop * scaleY,
        renderedCropFrame.width * scaleX,
        renderedCropFrame.height * scaleY,
        0,
        0,
        config.outputWidth,
        config.outputHeight
      )

      const blob = await canvasToBlob(canvas, preferredOutputType(file.type))
      await onApply(blob)
    } finally {
      setCropPending(false)
    }
  }

  async function handleApplyClick() {
    try {
      await handleApply()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't crop image"
      )
    }
  }

  function updateStageSizeFromDom() {
    const nextStageSize = readElementSize(stageRef.current)
    if (nextStageSize) {
      setStageSize((current) =>
        current.height === nextStageSize.height &&
        current.width === nextStageSize.width
          ? current
          : nextStageSize
      )
    }
    return nextStageSize
  }

  const setStageElement = React.useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node
    setStageNode(node)
  }, [])

  function handleZoomChange(value: number | readonly number[]) {
    const nextZoom = Array.isArray(value) ? (value[0] ?? 1) : value
    const liveStageSize =
      readElementSize(stageRef.current) ?? effectiveStageSize
    const liveContainedImageBox = loadedImage
      ? getImageBox(loadedImage, liveStageSize, 1)
      : null
    const liveCropFrame = getCropFrame(
      liveStageSize,
      config.aspect,
      mode,
      liveContainedImageBox
    )
    const liveImageBox = loadedImage
      ? getImageBox(loadedImage, liveStageSize, nextZoom)
      : null

    setZoom(nextZoom)
    setOffset((current) =>
      clampImageOffset(current, liveCropFrame, liveImageBox)
    )
  }

  const imagePlacement =
    cropReady && imageBox
      ? getImagePlacement(effectiveStageSize, imageBox, offset)
      : null
  const cropCovered =
    cropReady && imagePlacement
      ? isCropCovered(cropFrame, imagePlacement)
      : false
  const applyDisabled = !cropCovered || applying || cropPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="secondary"
        className="flex max-h-[calc(100vh-24px)] w-[min(640px,calc(100vw-24px))] max-w-none flex-col"
      >
        <DialogHeader>
          <DialogTitle>{config.label}</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-col gap-6 py-6">
          <div
            className={cn(
              "relative mx-auto w-full max-w-[560px] overflow-hidden rounded-md bg-surface-sunken",
              mode === "avatar" ? "aspect-[4/3]" : "aspect-video"
            )}
            ref={setStageElement}
          >
            {cropReady && imagePlacement ? (
              <div
                role="application"
                aria-label="Drag image to reposition crop"
                className="absolute inset-0 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
              >
                <img
                  alt=""
                  draggable={false}
                  src={loadedImage.src}
                  className="pointer-events-none absolute max-w-none opacity-45 select-none"
                  style={{
                    height: imagePlacement.height,
                    left: imagePlacement.left,
                    top: imagePlacement.top,
                    width: imagePlacement.width,
                  }}
                />
                <div
                  className="pointer-events-none absolute overflow-hidden ring-3 ring-accent ring-inset"
                  style={{
                    height: cropFrame.height,
                    left: cropFrame.x,
                    top: cropFrame.y,
                    width: cropFrame.width,
                  }}
                >
                  <img
                    alt=""
                    draggable={false}
                    src={loadedImage.src}
                    className="pointer-events-none absolute max-w-none select-none"
                    style={{
                      height: imagePlacement.height,
                      left: imagePlacement.left - cropFrame.x,
                      top: imagePlacement.top - cropFrame.y,
                      width: imagePlacement.width,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-surface-sunken text-foreground-faint">
                <ImageIcon className="size-8" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Minus className="size-4 shrink-0 text-foreground-faint" />
            <Slider
              aria-label="Zoom"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onValueChange={handleZoomChange}
              disabled={controlsDisabled}
            />
            <Plus className="size-4 shrink-0 text-foreground-faint" />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={applying || cropPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void handleApplyClick()}
            disabled={applyDisabled}
          >
            {applyDisabled && (applying || cropPending)
              ? "Applying..."
              : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function pointsEqual(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y
}

function clampImageOffset(
  next: Point,
  cropFrame: CropFrame,
  imageBox: { height: number; width: number } | null
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

function fallbackStageSize(mode: CropMode) {
  return mode === "avatar"
    ? { height: 420, width: 560 }
    : { height: 315, width: 560 }
}

function getImageBox(
  image: Pick<LoadedImage, "height" | "width">,
  stage: { height: number; width: number },
  zoom: number
) {
  const baseScale = Math.min(
    stage.width / image.width,
    stage.height / image.height
  )
  return {
    height: image.height * baseScale * zoom,
    width: image.width * baseScale * zoom,
  }
}

function getImagePlacement(
  stage: { height: number; width: number },
  imageBox: { height: number; width: number },
  offset: Point
) {
  return {
    height: imageBox.height,
    left: (stage.width - imageBox.width) / 2 + offset.x,
    top: (stage.height - imageBox.height) / 2 + offset.y,
    width: imageBox.width,
  }
}

type CropFrame = {
  height: number
  stageHeight: number
  stageWidth: number
  width: number
  x: number
  y: number
}

function getCropFrame(
  stage: { height: number; width: number },
  aspect: number,
  mode: CropMode,
  containedImageBox: { height: number; width: number } | null
): CropFrame {
  const preferredMaxWidth =
    mode === "avatar" ? stage.height * 0.78 : stage.width
  const preferredMaxHeight =
    mode === "avatar" ? stage.height * 0.78 : stage.height * 0.54
  const maxWidth = Math.min(
    preferredMaxWidth,
    containedImageBox?.width ?? preferredMaxWidth
  )
  const maxHeight = Math.min(
    preferredMaxHeight,
    containedImageBox?.height ?? preferredMaxHeight
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

function isCropCovered(
  cropFrame: CropFrame,
  image: { height: number; left: number; top: number; width: number }
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

function readElementSize(node: HTMLElement | null) {
  if (!node) return null

  if (node.clientWidth <= 0 || node.clientHeight <= 0) return null
  return { height: node.clientHeight, width: node.clientWidth }
}

function preferredOutputType(type: string) {
  return type === "image/png" || type === "image/webp" ? type : "image/jpeg"
}

async function readFileAsDataUrl(file: File): Promise<string> {
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

async function readImageDimensions(file: File) {
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

async function loadImage(src: string): Promise<HTMLImageElement> {
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

async function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, 0.92)
  })

  if (!blob) throw new Error("Couldn't crop image")
  return blob
}
