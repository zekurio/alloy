import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Slider } from "@alloy/ui/components/slider"
import { canvasBlurHash } from "@alloy/ui/lib/blurhash-encode"
import { cn } from "@alloy/ui/lib/utils"
import { useMutation } from "@tanstack/react-query"
import { CircleAlertIcon, ImageIcon, Minus, Plus } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent } from "react"

import { errorMessage } from "@/lib/error-message"
import { requireObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import {
  canvasToBlob,
  clamp,
  clampImageOffset,
  CROP_CONFIG,
  type CropMode,
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
} from "./image-crop-utils"

export interface ImageCropResult {
  blob: Blob
  /** Populated when the canvas can be sampled; null on capture failure. */
  blurHash: string | null
}

type CropSource =
  | { file: File; image: LoadedImage; error: null }
  | { file: File; image: null; error: string }

/** Zoom and pan; a null zoom fits the image to the crop until changed. */
type CropView = {
  file: File | null
  zoom: number | null
  offset: Point
}

const INITIAL_VIEW: CropView = {
  file: null,
  zoom: null,
  offset: { x: 0, y: 0 },
}

export function ImageCropDialog({
  file,
  mode,
  open,
  applying,
  onApply,
  onOpenChange,
}: {
  file: File | null
  mode: CropMode
  open: boolean
  /** The caller's own work after `onApply`, e.g. an upload. */
  applying: boolean
  onApply: (result: ImageCropResult) => Promise<void>
  onOpenChange: (open: boolean) => void
}) {
  const config = CROP_CONFIG[mode]
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  // Loaded images and the view belong to the file they were made for, so a
  // new file starts fresh without resetting anything.
  const [source, setSource] = useState<CropSource | null>(null)
  const [storedView, setView] = useState<CropView>(INITIAL_VIEW)
  const [stageSize, setStageSize] = useState({ height: 0, width: 0 })
  const current = open && file && source?.file === file ? source : null
  const loadedImage = current?.image ?? null
  const view = storedView.file === file ? storedView : INITIAL_VIEW
  const stageReady = stageSize.width > 0 && stageSize.height > 0
  const cropReady = !!loadedImage && stageReady
  const effectiveStageSize = useMemo(
    () => (stageReady ? stageSize : fallbackStageSize(mode)),
    [mode, stageSize],
  )
  const containedImageBox = useMemo(() => {
    if (!loadedImage) return null
    return getImageBox(loadedImage, effectiveStageSize, 1)
  }, [effectiveStageSize, loadedImage])
  const cropFrame = useMemo(
    () =>
      getCropFrame(effectiveStageSize, config.aspect, mode, containedImageBox),
    [config.aspect, containedImageBox, effectiveStageSize, mode],
  )
  const minimumZoom = useMemo(
    () => getMinimumZoom(mode, containedImageBox, cropFrame),
    [containedImageBox, cropFrame, mode],
  )
  const zoom = clamp(view.zoom ?? minimumZoom, minimumZoom, MAX_PREVIEW_ZOOM)

  useEffect(() => {
    if (!file || !open) return

    let active = true
    let src: string | null = null

    const load = async () => {
      src = requireObjectUrl(file, "crop source")
      const element = await loadImage(src)

      if (!active) return

      setSource({
        file,
        image: {
          element,
          height: element.naturalHeight,
          src,
          width: element.naturalWidth,
        },
        error: null,
      })
    }

    load().catch((cause) => {
      if (active) {
        setSource({
          file,
          image: null,
          error: errorMessage(cause, t("Couldn't load image")),
        })
      }
    })

    return () => {
      active = false
      revokeObjectUrl(src, "crop source")
      // Reopening with the same file must not show the revoked URL or the
      // last session's zoom.
      setSource((current) => (current?.file === file ? null : current))
      setView((current) => (current.file === file ? INITIAL_VIEW : current))
    }
  }, [file, open])

  // Stores the stage's layout size when it changed. clientWidth ignores the
  // dialog's open transform, which would skew a bounding-rect measure.
  const measureStage = useCallback(() => {
    const nextSize = readElementSize(stageRef.current)
    if (nextSize) {
      setStageSize((current) =>
        current.height === nextSize.height && current.width === nextSize.width
          ? current
          : nextSize,
      )
    }
    return nextSize
  }, [])

  // The stage mounts with the dialog's popup. Measuring on attach keeps the
  // first paint at the real size; the observer follows later changes.
  const setStageElement = useCallback(
    (node: HTMLDivElement) => {
      stageRef.current = node
      measureStage()
      const observer = new ResizeObserver(() => measureStage())
      observer.observe(node)
      return () => {
        observer.disconnect()
        stageRef.current = null
      }
    },
    [measureStage],
  )

  const imageBox = useMemo(() => {
    if (!loadedImage) {
      return null
    }

    return getImageBox(loadedImage, effectiveStageSize, zoom)
  }, [effectiveStageSize, loadedImage, zoom])

  const offset = useMemo(() => {
    if (!imageBox) return { x: 0, y: 0 }
    const next = clampImageOffset(view.offset, cropFrame, imageBox)
    return pointsEqual(view.offset, next) ? view.offset : next
  }, [cropFrame, imageBox, view.offset])

  const apply = useMutation({
    // Cropping is local; a failed upload must surface rather than pause the
    // dialog, which can't close while applying.
    networkMode: "always",
    mutationFn: async (_target: File) => {
      if (!file || !loadedImage) return
      const renderedStageSize = readElementSize(stageRef.current) ?? stageSize
      const { cropFrame: renderedCropFrame, imageBox: renderedImageBox } =
        getLiveCropGeometry(loadedImage, renderedStageSize, config, mode, zoom)
      const placement = getImagePlacement(
        renderedStageSize,
        renderedImageBox,
        offset,
      )
      const cropLeft = renderedCropFrame.x - placement.left
      const cropTop = renderedCropFrame.y - placement.top
      const scaleX = loadedImage.width / renderedImageBox.width
      const scaleY = loadedImage.height / renderedImageBox.height
      const canvas = document.createElement("canvas")
      canvas.width = config.outputWidth
      canvas.height = config.outputHeight

      const context = canvas.getContext("2d")
      if (!context) throw new Error("Image cropping is not supported")

      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = "high"
      context.drawImage(
        loadedImage.element,
        cropLeft * scaleX,
        cropTop * scaleY,
        renderedCropFrame.width * scaleX,
        renderedCropFrame.height * scaleY,
        0,
        0,
        config.outputWidth,
        config.outputHeight,
      )

      const blurHash = safeCanvasBlurHash(canvas)
      const blob = await canvasToBlob(canvas, preferredOutputType(file.type))
      await onApply({ blob, blurHash })
    },
  })
  const busy = applying || apply.isPending
  const controlsDisabled = !cropReady || busy
  const actionError =
    current?.error ??
    (apply.error && apply.variables === file
      ? errorMessage(apply.error, t("Couldn't crop image"))
      : null)

  function setViewFor(next: Omit<CropView, "file">) {
    setView({ file, ...next })
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!cropReady || applying) return

    measureStage()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      origin: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      startOffset: offset,
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !loadedImage) return

    const liveStageSize = measureStage() ?? effectiveStageSize
    const { cropFrame: liveCropFrame, imageBox: liveImageBox } =
      getLiveCropGeometry(loadedImage, liveStageSize, config, mode, zoom)
    setViewFor({
      zoom,
      offset: clampImageOffset(
        {
          x: drag.startOffset.x + event.clientX - drag.origin.x,
          y: drag.startOffset.y + event.clientY - drag.origin.y,
        },
        liveCropFrame,
        liveImageBox,
      ),
    })
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleApplyClick() {
    if (!file || !cropReady || apply.isPending) return
    apply.mutate(file)
  }

  function handleZoomChange(value: number | readonly number[]) {
    if (!loadedImage) return
    const rawZoom = Array.isArray(value) ? (value[0] ?? 1) : value
    const nextZoom = clamp(rawZoom, minimumZoom, MAX_PREVIEW_ZOOM)
    const liveStageSize =
      readElementSize(stageRef.current) ?? effectiveStageSize
    const { cropFrame: liveCropFrame, imageBox: liveImageBox } =
      getLiveCropGeometry(loadedImage, liveStageSize, config, mode, nextZoom)

    setViewFor({
      zoom: nextZoom,
      offset: clampImageOffset(offset, liveCropFrame, liveImageBox),
    })
  }

  const imagePlacement =
    cropReady && imageBox
      ? getImagePlacement(effectiveStageSize, imageBox, offset)
      : null
  const cropCovered =
    cropReady && imagePlacement
      ? isCropCovered(cropFrame, imagePlacement)
      : false
  const applyDisabled = !cropCovered || busy

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-apply would drop the result, including a failure the
        // dialog still has to show.
        if (!next && busy) return
        onOpenChange(next)
      }}
    >
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
              config.stageClass,
            )}
            ref={setStageElement}
          >
            {cropReady && imagePlacement ? (
              <div
                role="application"
                aria-label={t("Drag image to reposition crop")}
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
              aria-label={t("Zoom")}
              min={minimumZoom}
              max={MAX_PREVIEW_ZOOM}
              step={0.01}
              value={zoom}
              onValueChange={handleZoomChange}
              disabled={controlsDisabled}
            />
            <Plus className="text-foreground-faint size-4 shrink-0" />
          </div>
          {actionError ? (
            <Callout tone="destructive" className="text-xs">
              <CircleAlertIcon />
              <span>{actionError}</span>
            </Callout>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("Cancel")}
          </Button>
          <FeedbackButton
            type="button"
            variant="primary"
            size="sm"
            onClick={handleApplyClick}
            disabled={applyDisabled}
            state={busy ? "pending" : actionError ? "error" : "idle"}
            pendingLabel={t("Applying...")}
            errorLabel={t("Try again")}
          >
            {t("Apply")}
          </FeedbackButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function safeCanvasBlurHash(canvas: HTMLCanvasElement): string | null {
  try {
    return canvasBlurHash(canvas)
  } catch {
    return null
  }
}
