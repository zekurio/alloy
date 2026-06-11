import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { Slider } from "@alloy/ui/components/slider"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { ImageIcon, Minus, Plus } from "lucide-react"
import * as React from "react"

import { errorMessage } from "@/lib/error-message"

import {
  canvasToBlob,
  clamp,
  clampImageOffset,
  CROP_CONFIG,
  type CropMode,
  DEFAULT_PREVIEW_ZOOM,
  type DragState,
  fallbackStageSize,
  getCropFrame,
  getImageBox,
  getImagePlacement,
  getLiveCropGeometry,
  getMinimumZoom,
  isCropCovered,
  type LoadedImage,
  loadImage,
  MAX_PREVIEW_ZOOM,
  type Point,
  pointsEqual,
  preferredOutputType,
  readElementSize,
  readFileAsDataUrl,
  readImageDimensions,
} from "./profile-image-crop-utils"

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
  const zoomInitializedRef = React.useRef(false)
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
    [mode, stageSize],
  )
  const containedImageBox = React.useMemo(() => {
    if (!loadedImage) return null
    return getImageBox(loadedImage, effectiveStageSize, 1)
  }, [effectiveStageSize, loadedImage])
  const cropFrame = React.useMemo(
    () =>
      getCropFrame(effectiveStageSize, config.aspect, mode, containedImageBox),
    [config.aspect, containedImageBox, effectiveStageSize, mode],
  )
  const minimumZoom = React.useMemo(
    () => getMinimumZoom(mode, containedImageBox, cropFrame),
    [containedImageBox, cropFrame, mode],
  )

  React.useEffect(() => {
    onApplyingChange?.(cropPending)
  }, [cropPending, onApplyingChange])

  React.useEffect(() => {
    if (!file || !open) {
      setLoadedImage(null)
      setStageSize({ height: 0, width: 0 })
      setCropPending(false)
      zoomInitializedRef.current = false
      return
    }

    let active = true
    setLoadedImage(null)
    setStageSize({ height: 0, width: 0 })
    setCropPending(false)
    zoomInitializedRef.current = false

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

    load().catch((cause) => {
      if (active) {
        setLoadedImage(null)
        toast.error(errorMessage(cause, "Couldn't load image"))
      }
    })

    return () => {
      active = false
    }
  }, [file, open])

  React.useEffect(() => {
    if (!cropReady || zoomInitializedRef.current) return

    zoomInitializedRef.current = true
    setOffset({ x: 0, y: 0 })
    setZoom(minimumZoom)
  }, [cropReady, minimumZoom])

  React.useEffect(() => {
    setZoom((current) => clamp(current, minimumZoom, MAX_PREVIEW_ZOOM))
  }, [minimumZoom])

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
    [cropFrame, imageBox],
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
    const { cropFrame: liveCropFrame, imageBox: liveImageBox } =
      getLiveCropGeometry(loadedImage, liveStageSize, config, mode, zoom)
    setOffset(
      clampImageOffset(
        {
          x: drag.startOffset.x + event.clientX - drag.origin.x,
          y: drag.startOffset.y + event.clientY - drag.origin.y,
        },
        liveCropFrame,
        liveImageBox,
      ),
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
        1,
      )
      const renderedCropFrame = getCropFrame(
        renderedStageSize,
        config.aspect,
        mode,
        renderedContainedImageBox,
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
        config.outputHeight,
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
      toast.error(errorMessage(cause, "Couldn't crop image"))
    }
  }

  function updateStageSizeFromDom() {
    const nextStageSize = readElementSize(stageRef.current)
    if (nextStageSize) {
      setStageSize((current) =>
        current.height === nextStageSize.height &&
        current.width === nextStageSize.width
          ? current
          : nextStageSize,
      )
    }
    return nextStageSize
  }

  const setStageElement = React.useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node
    setStageNode(node)
  }, [])

  function handleZoomChange(value: number | readonly number[]) {
    const rawZoom = Array.isArray(value) ? (value[0] ?? 1) : value
    const nextZoom = clamp(rawZoom, minimumZoom, MAX_PREVIEW_ZOOM)
    const liveStageSize =
      readElementSize(stageRef.current) ?? effectiveStageSize
    const { cropFrame: liveCropFrame, imageBox: liveImageBox } =
      getLiveCropGeometry(loadedImage, liveStageSize, config, mode, nextZoom)

    setZoom(nextZoom)
    setOffset((current) =>
      clampImageOffset(current, liveCropFrame, liveImageBox),
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
              mode === "avatar" ? "aspect-[4/3]" : "aspect-video",
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
                  className="ring-accent pointer-events-none absolute overflow-hidden ring-3 ring-inset"
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
              <div className="bg-surface-sunken text-foreground-faint absolute inset-0 grid place-items-center">
                <ImageIcon className="size-8" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Minus className="text-foreground-faint size-4 shrink-0" />
            <Slider
              aria-label="Zoom"
              min={minimumZoom}
              max={MAX_PREVIEW_ZOOM}
              step={0.01}
              value={zoom}
              onValueChange={handleZoomChange}
              disabled={controlsDisabled}
            />
            <Plus className="text-foreground-faint size-4 shrink-0" />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
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
