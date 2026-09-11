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

import {
  canMoveScreenshotCropAt,
  DEFAULT_SCREENSHOT_EDIT,
  drawScreenshot,
  fitScreenshotCrop,
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
  const canvas = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const drag = useRef<CropDrag | null>(null)
  useEffect(() => {
    let cancelled = false
    let bitmap: ImageBitmap | null = null
    setError(null)
    setImage(null)
    const source = mediaUrl
      ? fetch(mediaUrl).then((response) => {
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
        if (cancelled) loaded.close()
        else setImage(loaded)
      })
      .catch(() => {
        if (!cancelled) setError(t("Couldn't open image"))
      })
    return () => {
      cancelled = true
      bitmap?.close()
    }
  }, [file, mediaUrl])
  useEffect(() => {
    if (canvas.current && image && image.width > 0 && image.height > 0)
      drawScreenshot(canvas.current, image, value, 1600)
  }, [image, value])
  const dimensions = image
    ? screenshotDimensions(image.width, image.height, value.rotation)
    : { width: 16, height: 9 }
  const ratio =
    aspectRatio === "free"
      ? null
      : aspectRatio === "original"
        ? image
          ? image.width / image.height
          : null
        : Number(aspectRatio.split(":")[0]) / Number(aspectRatio.split(":")[1])
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
  const hasCrop =
    value.crop.x !== 0 ||
    value.crop.y !== 0 ||
    value.crop.width !== 1 ||
    value.crop.height !== 1
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
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      onKeyDown={(event) => {
        if (unavailable || !(event.ctrlKey || event.metaKey) || event.altKey)
          return
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
      }}
    >
      <div className="[container-type:size] relative grid h-[52dvh] min-h-0 place-items-center overflow-hidden rounded-md lg:h-auto lg:flex-1">
        {error ? (
          <p role="alert" className="text-destructive px-4 text-sm">
            {error}
          </p>
        ) : null}
        <div
          className={cn(
            "relative overflow-hidden bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            cropping && "cursor-crosshair",
          )}
          style={{
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
          onKeyDown={(event) => {
            if (
              !cropping ||
              unavailable ||
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
              )
            )
              return
            event.preventDefault()
            const dx =
              event.key === "ArrowLeft"
                ? -0.01
                : event.key === "ArrowRight"
                  ? 0.01
                  : 0
            const dy =
              event.key === "ArrowUp"
                ? -0.01
                : event.key === "ArrowDown"
                  ? 0.01
                  : 0
            const crop = { ...value.crop }
            if (event.shiftKey) {
              const normalizedRatio = ratio
                ? (ratio * dimensions.height) / dimensions.width
                : null
              let width = Math.max(0.01, crop.width + dx)
              let height = Math.max(0.01, crop.height + dy)
              if (normalizedRatio) {
                if (dx) height = width / normalizedRatio
                else width = height * normalizedRatio
              }
              const scale = Math.min(
                1,
                (1 - crop.x) / width,
                (1 - crop.y) / height,
              )
              crop.width = width * scale
              crop.height = height * scale
            } else {
              crop.x = Math.max(0, Math.min(1 - crop.width, crop.x + dx))
              crop.y = Math.max(0, Math.min(1 - crop.height, crop.y + dy))
            }
            history.change({ ...value, crop }, aspectRatio, true)
          }}
          onKeyUp={history.commit}
          onBlur={history.commit}
          onPointerDown={(event) => {
            if (disabled || !image || !cropping || event.button !== 0) return
            event.currentTarget.focus()
            const rect = event.currentTarget.getBoundingClientRect()
            const startX = Math.max(
              0,
              Math.min(1, (event.clientX - rect.left) / rect.width),
            )
            const startY = Math.max(
              0,
              Math.min(1, (event.clientY - rect.top) / rect.height),
            )
            const insideCrop = canMoveScreenshotCropAt(
              value.crop,
              startX,
              startY,
            )
            const target = event.target
            const handle = CROP_HANDLE_NAMES.find(
              (name) =>
                target instanceof HTMLElement &&
                target.dataset.cropHandle === name,
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
          }}
          onPointerMove={(event) => {
            const start = drag.current
            if (
              !start ||
              start.pointerId !== event.pointerId ||
              disabled ||
              !cropping
            )
              return
            const rect = event.currentTarget.getBoundingClientRect()
            const x = Math.max(
              0,
              Math.min(1, (event.clientX - rect.left) / rect.width),
            )
            const y = Math.max(
              0,
              Math.min(1, (event.clientY - rect.top) / rect.height),
            )
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
            if (
              Math.abs(x - start.startX) < 0.01 ||
              Math.abs(y - start.startY) < 0.01
            )
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
            crop.y =
              y < start.startY ? start.startY - crop.height : start.startY
            history.change({ ...value, crop }, aspectRatio, true)
          }}
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
        <div className="ml-auto flex items-center gap-3">
          <Select
            value={aspectRatio}
            disabled={unavailable}
            onValueChange={(selected) => {
              const next = ASPECT_RATIOS.find((option) => option === selected)
              if (!next || !image) return
              const nextRatio =
                next === "free"
                  ? null
                  : next === "original"
                    ? image.width / image.height
                    : Number(next.split(":")[0]) / Number(next.split(":")[1])
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
            <SelectTrigger size="sm" aria-label={t("Aspect ratio")}>
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
          <span
            aria-label={t("Image dimensions")}
            className="text-foreground-faint font-mono text-xs tabular-nums"
          >
            {image ? `${outputWidth} × ${outputHeight}` : "—"}
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
