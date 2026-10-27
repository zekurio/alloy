import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { Slider } from "@alloy/ui/components/slider"
import { cn } from "@alloy/ui/lib/utils"
import {
  CropIcon,
  FlipHorizontal2Icon,
  FlipVertical2Icon,
  RotateCcwIcon,
  RotateCwIcon,
  Undo2Icon,
  Redo2Icon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent } from "react"

import { clientLogger } from "@/lib/client-log"

import { ImageZoomControls, useImageZoom } from "./image-zoom"
import {
  canMoveScreenshotCropAt,
  DEFAULT_SCREENSHOT_EDIT,
  drawScreenshot,
  fitScreenshotCrop,
  isFullScreenshotCrop,
  moveScreenshotCrop,
  resizeScreenshotCrop,
  type CropHandle,
  screenshotDimensions,
  type ScreenshotEdit,
} from "./screenshot-edit"
import { useScreenshotHistory } from "./use-screenshot-history"

const ASPECT_RATIOS = [
  "free",
  "original",
  "1:1",
  "16:9",
  "4:3",
  "3:2",
  "21:9",
  "9:16",
  "3:4",
  "2:3",
] as const

type CropDrag = {
  pointerId: number
  startX: number
  startY: number
} & (
  | { kind: "create" }
  | { kind: "move"; startCrop: ScreenshotEdit["crop"] }
  | { kind: "resize"; handle: CropHandle; startCrop: ScreenshotEdit["crop"] }
)

const CROP_HANDLES = {
  n: "inset-x-3 top-0 h-3 cursor-ns-resize",
  s: "inset-x-3 bottom-0 h-3 cursor-ns-resize",
  e: "inset-y-3 right-0 w-3 cursor-ew-resize",
  w: "inset-y-3 left-0 w-3 cursor-ew-resize",
  nw: "top-0 left-0 size-5 cursor-nwse-resize border-t-2 border-l-2",
  ne: "top-0 right-0 size-5 cursor-nesw-resize border-t-2 border-r-2",
  sw: "bottom-0 left-0 size-5 cursor-nesw-resize border-b-2 border-l-2",
  se: "bottom-0 right-0 size-5 cursor-nwse-resize border-b-2 border-r-2",
} satisfies Record<CropHandle, string>

const CROP_HANDLE_NAMES: CropHandle[] = [
  "n",
  "s",
  "e",
  "w",
  "nw",
  "ne",
  "sw",
  "se",
]

/** Pixel aspect ratio for a ratio option, or null for a free crop. */
function aspectRatioValue(
  option: string,
  image: ImageBitmap | null,
): number | null {
  if (option === "free") return null
  if (option === "original") return image ? image.width / image.height : null
  const [width, height] = option.split(":")
  return Number(width) / Number(height)
}

/** Pointer position as a fraction of the element's box, clamped to 0..1. */
function pointerFraction(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  }
}

type OpenedScreenshot = {
  file: File | undefined
  mediaUrl: string | undefined
  image: ImageBitmap | null
  error: string | null
}

export function ScreenshotEditor({
  file,
  mediaUrl,
  value: initialValue,
  onChange,
  disabled,
}: {
  file?: File
  mediaUrl?: string
  value: ScreenshotEdit
  onChange: (edit: ScreenshotEdit) => void
  disabled?: boolean
}) {
  const ratioLabel = (option: string) =>
    option === "free"
      ? t("Free")
      : option === "original"
        ? t("Original")
        : option === "1:1"
          ? t("Square")
          : option
  const [cropping, setCropping] = useState(false)
  const history = useScreenshotHistory(initialValue, onChange)
  const { edit: value, aspectRatio } = history.snapshot
  const drag = useRef<CropDrag | null>(null)
  const view = useImageZoom(() => {
    drag.current = null
    history.commit()
  })
  const canvas = useRef<HTMLCanvasElement>(null)
  // The decoded bitmap (or failure) for the source it came from; a source
  // switch reads as loading until the new one decodes.
  const [opened, setOpened] = useState<OpenedScreenshot | null>(null)
  const current =
    opened && opened.file === file && opened.mediaUrl === mediaUrl
      ? opened
      : null
  const image = current?.image ?? null
  const error = current?.error ?? null
  useEffect(() => {
    const controller = new AbortController()
    let bitmap: ImageBitmap | null = null
    const source = mediaUrl
      ? fetch(mediaUrl, { signal: controller.signal }).then((response) => {
          if (!response.ok) throw new Error("Could not read screenshot")
          return response.blob()
        })
      : file
        ? Promise.resolve(file)
        : Promise.reject(new Error("Screenshot is missing"))
    void source
      .then((blob) => createImageBitmap(blob))
      .then((loaded) => {
        bitmap = loaded
        if (controller.signal.aborted) loaded.close()
        else setOpened({ file, mediaUrl, image: loaded, error: null })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        clientLogger.warn("[screenshot-editor] Failed to open image.", cause)
        setOpened({
          file,
          mediaUrl,
          image: null,
          error: t("Couldn't open image"),
        })
      })
    return () => {
      controller.abort()
      if (!bitmap) return
      const closed = bitmap
      closed.close()
      // An <Activity> hide re-runs this effect for the same source, so drop
      // the closed bitmap rather than keep drawing from it.
      setOpened((current) => (current?.image === closed ? null : current))
    }
  }, [file, mediaUrl])
  useEffect(() => {
    if (canvas.current && image && image.width > 0 && image.height > 0)
      drawScreenshot(canvas.current, image, value, 1600 * view.zoom)
  }, [image, value, view.zoom])
  const dimensions = image
    ? screenshotDimensions(image.width, image.height, value.rotation)
    : { width: 16, height: 9 }
  const ratio = aspectRatioValue(aspectRatio, image)
  const transform = (change: Partial<ScreenshotEdit>, preview = false) => {
    const next = { ...value, ...change }
    const size = image
      ? screenshotDimensions(image.width, image.height, next.rotation)
      : dimensions
    history.change(
      {
        ...next,
        crop: fitScreenshotCrop(DEFAULT_SCREENSHOT_EDIT.crop, size, ratio),
      },
      aspectRatio,
      preview,
    )
  }
  const hasCrop = !isFullScreenshotCrop(value.crop)
  const edited = value.rotation !== 0 || value.flipX || value.flipY || hasCrop
  const unavailable = disabled || !image
  const outputWidth = Math.max(
    1,
    Math.round(dimensions.width * value.crop.width),
  )
  const outputHeight = Math.max(
    1,
    Math.round(dimensions.height * value.crop.height),
  )

  const handleHistoryKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (unavailable || !(event.ctrlKey || event.metaKey) || event.altKey) return
    const target = event.target
    if (
      target instanceof HTMLElement &&
      target.closest(
        "textarea, [contenteditable=true], input:not([type=range])",
      )
    )
      return
    const key = event.key.toLowerCase()
    if (key !== "z" && key !== "y") return
    event.preventDefault()
    event.stopPropagation()
    if (key === "y" || event.shiftKey) history.redo()
    else history.undo()
  }

  // Arrow keys move the crop by 1% of the image; with Shift they resize it
  // from the bottom-right corner, like dragging that handle.
  const handleCropKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !cropping ||
      unavailable ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return
    event.preventDefault()
    const dx =
      event.key === "ArrowLeft" ? -0.01 : event.key === "ArrowRight" ? 0.01 : 0
    const dy =
      event.key === "ArrowUp" ? -0.01 : event.key === "ArrowDown" ? 0.01 : 0
    const crop = event.shiftKey
      ? resizeScreenshotCrop(value.crop, "se", dx, dy, dimensions, ratio)
      : moveScreenshotCrop(value.crop, dx, dy)
    history.change({ ...value, crop }, aspectRatio, true)
  }

  const handleCropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      disabled ||
      !image ||
      !cropping ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return
    event.currentTarget.focus()
    const { x: startX, y: startY } = pointerFraction(event)
    const insideCrop = canMoveScreenshotCropAt(value.crop, startX, startY)
    const target = event.target
    const handle = CROP_HANDLE_NAMES.find(
      (name) =>
        target instanceof HTMLElement && target.dataset.cropHandle === name,
    )
    drag.current = handle
      ? {
          kind: "resize",
          handle,
          pointerId: event.pointerId,
          startX,
          startY,
          startCrop: { ...value.crop },
        }
      : insideCrop
        ? {
            kind: "move",
            pointerId: event.pointerId,
            startX,
            startY,
            startCrop: { ...value.crop },
          }
        : { kind: "create", pointerId: event.pointerId, startX, startY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleCropPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId || disabled || !cropping)
      return
    const { x, y } = pointerFraction(event)
    if (start.kind === "move" || start.kind === "resize") {
      history.change(
        {
          ...value,
          crop:
            start.kind === "resize"
              ? resizeScreenshotCrop(
                  start.startCrop,
                  start.handle,
                  x - start.startX,
                  y - start.startY,
                  dimensions,
                  ratio,
                )
              : moveScreenshotCrop(
                  start.startCrop,
                  x - start.startX,
                  y - start.startY,
                ),
        },
        aspectRatio,
        true,
      )
      return
    }
    if (Math.abs(x - start.startX) < 0.01 || Math.abs(y - start.startY) < 0.01)
      return
    const crop = fitScreenshotCrop(
      {
        x: Math.min(start.startX, x),
        y: Math.min(start.startY, y),
        width: Math.abs(x - start.startX),
        height: Math.abs(y - start.startY),
      },
      dimensions,
      ratio,
    )
    crop.x = x < start.startX ? start.startX - crop.width : start.startX
    crop.y = y < start.startY ? start.startY - crop.height : start.startY
    history.change({ ...value, crop }, aspectRatio, true)
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      onKeyDown={handleHistoryKeyDown}
    >
      <div
        ref={view.viewportRef}
        className={cn(
          "[container-type:size] relative grid h-[52dvh] min-h-0 place-items-center overflow-hidden rounded-md lg:h-auto lg:flex-1",
          view.zoom > 1 && !cropping && "cursor-grab active:cursor-grabbing",
        )}
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
          if (!unavailable && (!cropping || event.button === 1))
            view.startPan(event)
        }}
        onPointerMove={view.movePan}
        onPointerUp={view.endPan}
        onPointerCancel={view.endPan}
      >
        {error ? (
          <p role="alert" className="text-destructive px-4 text-sm">
            {error}
          </p>
        ) : null}
        <div
          ref={view.contentRef}
          className={cn(
            "relative overflow-hidden bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            cropping && "cursor-crosshair",
          )}
          style={{
            ...view.style,
            touchAction: cropping ? "none" : "auto",
            width: `min(100cqw, calc(100cqh * ${dimensions.width / dimensions.height}))`,
            aspectRatio: dimensions.width / dimensions.height,
          }}
          tabIndex={cropping && !unavailable ? 0 : undefined}
          role={cropping ? "group" : undefined}
          aria-label={cropping ? t("Crop") : undefined}
          aria-description={
            cropping
              ? t("Arrow keys move the crop. Shift + arrow keys resize it.")
              : undefined
          }
          onKeyDown={handleCropKeyDown}
          onKeyUp={history.commit}
          onBlur={history.commit}
          onPointerDown={handleCropPointerDown}
          onPointerMove={handleCropPointerMove}
          onPointerUp={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return
            drag.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
            history.commit()
          }}
          onPointerCancel={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return
            drag.current = null
            history.commit()
          }}
        >
          <canvas
            ref={canvas}
            aria-label={t("Screenshot preview")}
            className="block h-auto w-full"
          />
          {image && (cropping || edited) ? (
            <div
              aria-hidden="true"
              className={cn(
                "absolute shadow-[0_0_0_9999px_#000a]",
                cropping &&
                  "outline outline-1 -outline-offset-1 outline-white/80",
                cropping && hasCrop
                  ? "pointer-events-auto cursor-move"
                  : "pointer-events-none",
              )}
              style={{
                left: `${value.crop.x * 100}%`,
                top: `${value.crop.y * 100}%`,
                width: `${value.crop.width * 100}%`,
                height: `${value.crop.height * 100}%`,
              }}
            >
              {cropping ? (
                <>
                  <div className="absolute inset-x-0 top-1/3 h-1/3 border-y border-white/20" />
                  <div className="absolute inset-y-0 left-1/3 w-1/3 border-x border-white/20" />
                  {CROP_HANDLE_NAMES.map((handle) => (
                    <div
                      key={handle}
                      data-crop-handle={handle}
                      className={cn(
                        "pointer-events-auto absolute z-10 border-white",
                        CROP_HANDLES[handle],
                      )}
                    />
                  ))}
                  {hasCrop ? (
                    <span className="absolute bottom-2 left-1/2 max-w-[calc(100%-1rem)] -translate-x-1/2 truncate rounded-sm border border-white/10 bg-black/75 px-2 py-1 font-mono text-[10px] leading-none text-white/90 tabular-nums shadow-sm backdrop-blur-sm">
                      {outputWidth} × {outputHeight}
                    </span>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div
        role="group"
        aria-label={t("Image tools")}
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2"
      >
        <div className="flex items-center gap-1">
          {[
            {
              label: t("Crop"),
              icon: CropIcon,
              pressed: cropping,
              action: () => setCropping(!cropping),
            },
            {
              label: t("Rotate left"),
              icon: RotateCcwIcon,
              action: () =>
                transform({
                  rotation: ((value.rotation - 90 + 540) % 360) - 180,
                }),
            },
            {
              label: t("Rotate right"),
              icon: RotateCwIcon,
              action: () =>
                transform({
                  rotation: ((value.rotation + 90 + 180) % 360) - 180,
                }),
            },
            {
              label: t("Flip horizontal"),
              icon: FlipHorizontal2Icon,
              pressed: value.flipX,
              action: () => transform({ flipX: !value.flipX }),
            },
            {
              label: t("Flip vertical"),
              icon: FlipVertical2Icon,
              pressed: value.flipY,
              action: () => transform({ flipY: !value.flipY }),
            },
          ].map(({ label, icon: Icon, pressed, action }) => (
            <Button
              key={label}
              type="button"
              variant={pressed ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={label}
              title={label}
              aria-pressed={pressed}
              disabled={unavailable}
              onClick={action}
              className={cn("size-9", pressed && "text-accent bg-accent-soft")}
            >
              <Icon />
            </Button>
          ))}
        </div>
        <div className="flex w-44 items-center gap-3">
          <Slider
            aria-label={t("Rotation")}
            min={-180}
            max={180}
            step={1}
            value={[value.rotation]}
            disabled={unavailable}
            size="touch"
            onValueCommitted={history.commit}
            onValueChange={(next) =>
              transform(
                { rotation: Array.isArray(next) ? next[0] : next },
                true,
              )
            }
          />
          <output
            aria-label={t("Rotation")}
            className="text-foreground-muted w-12 shrink-0 text-right font-mono text-xs tabular-nums"
          >
            {value.rotation}°
          </output>
        </div>
        <ImageZoomControls
          zoom={view.zoom}
          onChange={view.changeZoom}
          disabled={unavailable}
        />
        <div className="ml-auto flex items-center gap-3">
          <Select
            value={aspectRatio}
            disabled={unavailable}
            onValueChange={(selected) => {
              const next = ASPECT_RATIOS.find((option) => option === selected)
              if (!next || !image) return
              const nextRatio = aspectRatioValue(next, image)
              setCropping(true)
              history.change(
                {
                  ...value,
                  crop: fitScreenshotCrop(
                    DEFAULT_SCREENSHOT_EDIT.crop,
                    dimensions,
                    nextRatio,
                  ),
                },
                next,
              )
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("Aspect ratio")}
              className="border-transparent bg-transparent hover:border-transparent focus-visible:border-transparent disabled:bg-transparent"
            >
              <SelectValue>{ratioLabel(aspectRatio)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="alloy-blur">
              {ASPECT_RATIOS.map((option) => (
                <SelectItem key={option} value={option}>
                  {ratioLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Sized to the uncropped readout, the widest the crop can produce:
              a narrower one could unwrap the toolbar mid-drag, which resizes
              the viewport and moves the image under the pointer. */}
          <span
            aria-label={t("Image dimensions")}
            className="text-foreground-faint grid font-mono text-xs tabular-nums"
          >
            <span
              aria-hidden="true"
              className="invisible col-start-1 row-start-1"
            >
              {`${dimensions.width} × ${dimensions.height}`}
            </span>
            <span className="col-start-1 row-start-1 text-right">
              {image ? `${outputWidth} × ${outputHeight}` : "—"}
            </span>
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-9"
              aria-label={t("Undo")}
              title={t("Undo (Ctrl+Z)")}
              disabled={unavailable || !history.canUndo}
              onClick={history.undo}
            >
              <Undo2Icon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-9"
              aria-label={t("Redo")}
              title={t("Redo (Ctrl+Shift+Z)")}
              disabled={unavailable || !history.canRedo}
              onClick={history.redo}
            >
              <Redo2Icon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
