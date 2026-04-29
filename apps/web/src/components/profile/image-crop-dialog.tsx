import * as React from "react"
import Cropper, { type Area } from "react-easy-crop"
import { FlipHorizontal, FlipVertical, RotateCcw, RotateCw } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerTitle,
} from "@workspace/ui/components/drawer"
import { Slider } from "@workspace/ui/components/slider"

import {
  PROFILE_BANNER_ASPECT,
  PROFILE_BANNER_OUTPUT,
} from "@/lib/banner-layout"

export type ImageCropMode = "avatar" | "banner"

type ImageCropOutput = {
  maxWidth: number
  maxHeight: number
  type: "image/jpeg"
  quality: number
}

type ObjectFit = "contain" | "cover" | "horizontal-cover" | "vertical-cover"

/**
 * Per-mode customization. Everything that ISN'T listed here is shared between
 * avatar and banner — same Cropper props, same controls, same export pipeline.
 */
type ModeConfig = {
  aspect: number
  title: string
  output: ImageCropOutput
  /** When false the crop box can extend beyond the image edges. */
  restrictPosition: boolean
}

const CONFIG: Record<ImageCropMode, ModeConfig> = {
  avatar: {
    aspect: 1,
    title: "Crop avatar",
    output: { maxWidth: 512, maxHeight: 512, type: "image/jpeg", quality: 0.9 },
    restrictPosition: true,
  },
  banner: {
    aspect: PROFILE_BANNER_ASPECT,
    title: "Crop banner",
    output: {
      ...PROFILE_BANNER_OUTPUT,
      type: "image/jpeg",
      quality: 0.86,
    },
    restrictPosition: true,
  },
}

// Shared cropper settings — applied identically to both modes.
const OBJECT_FIT: ObjectFit = "cover"
const SHOW_GRID = true
const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.01
const CROP_AREA_INSET = 0.9

// Pane sizing — the preview pane adapts its aspect to the source image,
// bounded by these caps so wild aspects don't blow up the dialog.
const MAX_PANE_WIDTH = 720
const MAX_PANE_HEIGHT = 540
const MIN_PANE_ASPECT = 0.4
const MAX_PANE_ASPECT = 6
// Sum of horizontal padding inside DialogContent (DialogBody is `px-6`).
const DIALOG_HORIZONTAL_PADDING = 48
// Fallback dialog width when no image is loaded yet.
const FALLBACK_DIALOG_WIDTH = 768

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeRotation(value: number) {
  return ((value % 360) + 360) % 360
}

function readSliderValue(value: number | readonly number[], fallback: number) {
  if (Array.isArray(value)) return value[0] ?? fallback
  return typeof value === "number" ? value : fallback
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.addEventListener("load", () => resolve(img))
    img.addEventListener("error", () =>
      reject(new Error("Failed to load image"))
    )
    img.crossOrigin = "anonymous"
    img.src = src
  })
}

function rotatedBoundingBox(width: number, height: number, rotation: number) {
  const radians = (rotation * Math.PI) / 180
  const sin = Math.abs(Math.sin(radians))
  const cos = Math.abs(Math.cos(radians))
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  }
}

type Size = { width: number; height: number }

function computePaneSize(naturalWidth: number, naturalHeight: number): Size {
  const rawAspect = naturalWidth / naturalHeight
  const aspect = clamp(rawAspect, MIN_PANE_ASPECT, MAX_PANE_ASPECT)
  let width = MAX_PANE_WIDTH
  let height = width / aspect
  if (height > MAX_PANE_HEIGHT) {
    height = MAX_PANE_HEIGHT
    width = height * aspect
  }
  return { width, height }
}

type Flip = { horizontal: boolean; vertical: boolean }

async function renderCrop(opts: {
  src: string
  area: Area
  rotation: number
  flip: Flip
  output: ImageCropOutput
}): Promise<Blob> {
  const { src, area, rotation, flip, output } = opts
  const image = await loadImage(src)

  const work = document.createElement("canvas")
  const workCtx = work.getContext("2d")
  if (!workCtx) throw new Error("Canvas 2D context unavailable")

  const { width: bbW, height: bbH } = rotatedBoundingBox(
    image.naturalWidth,
    image.naturalHeight,
    rotation
  )
  work.width = Math.ceil(bbW)
  work.height = Math.ceil(bbH)
  workCtx.imageSmoothingQuality = "high"
  workCtx.translate(work.width / 2, work.height / 2)
  workCtx.rotate((rotation * Math.PI) / 180)
  workCtx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1)
  workCtx.translate(-image.naturalWidth / 2, -image.naturalHeight / 2)
  workCtx.drawImage(image, 0, 0)

  // Downscale crop to fit within output.max{Width,Height} while preserving
  // its own aspect.
  const sourceAspect = area.width / area.height
  const widthLimit = output.maxWidth
  const heightLimit = output.maxHeight
  let outW = Math.min(area.width, widthLimit)
  let outH = outW / sourceAspect
  if (outH > heightLimit) {
    outH = heightLimit
    outW = outH * sourceAspect
  }

  const out = document.createElement("canvas")
  out.width = Math.max(1, Math.round(outW))
  out.height = Math.max(1, Math.round(outH))
  const outCtx = out.getContext("2d")
  if (!outCtx) throw new Error("Canvas 2D context unavailable")
  outCtx.imageSmoothingQuality = "high"
  outCtx.drawImage(
    work,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    out.width,
    out.height
  )

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("Could not encode image"))
      },
      output.type,
      output.quality
    )
  })
}

type Point = { x: number; y: number }

type ImageCropperViewProps = {
  src: string
  aspect: number
  paneSize: Size
  crop: Point
  zoom: number
  rotation: number
  flipX: boolean
  flipY: boolean
  onCropChange: (point: Point) => void
  onZoomChange: (zoom: number) => void
  onRotationChange: (rotation: number) => void
  onFlipXToggle: () => void
  onFlipYToggle: () => void
  restrictPosition: boolean
  onCropAreaChange: (area: Area) => void
}

function computeCropSize(paneSize: Size, aspect: number): Size {
  const maxWidth = paneSize.width * CROP_AREA_INSET
  const maxHeight = paneSize.height * CROP_AREA_INSET
  let width = maxWidth
  let height = width / aspect

  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }

  return { width, height }
}

function ImageCropperView({
  src,
  aspect,
  paneSize,
  crop,
  zoom,
  rotation,
  flipX,
  flipY,
  onCropChange,
  onZoomChange,
  onRotationChange,
  restrictPosition,
  onFlipXToggle,
  onFlipYToggle,
  onCropAreaChange,
}: ImageCropperViewProps) {
  const paneRef = React.useRef<HTMLDivElement>(null)
  const [renderedPaneSize, setRenderedPaneSize] = React.useState<Size>(paneSize)

  const transform = `translate(${crop.x}px, ${crop.y}px) rotate(${rotation}deg) scale(${zoom}) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`

  React.useEffect(() => {
    setRenderedPaneSize(paneSize)
  }, [paneSize])

  React.useEffect(() => {
    const element = paneRef.current
    if (!element) return
    const measuredElement = element

    function updateRenderedSize() {
      const rect = measuredElement.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      setRenderedPaneSize((current) => {
        if (
          Math.abs(current.width - rect.width) < 0.5 &&
          Math.abs(current.height - rect.height) < 0.5
        ) {
          return current
        }

        return { width: rect.width, height: rect.height }
      })
    }

    updateRenderedSize()

    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(updateRenderedSize)
    observer.observe(measuredElement)
    return () => observer.disconnect()
  }, [paneSize])

  const cropSize = React.useMemo(
    () => computeCropSize(renderedPaneSize, aspect),
    [aspect, renderedPaneSize]
  )

  const handleCropComplete = React.useCallback(
    (_: Area, areaPixels: Area) => onCropAreaChange(areaPixels),
    [onCropAreaChange]
  )

  return (
    <>
      <div
        ref={paneRef}
        className="relative mx-auto overflow-hidden"
        style={{
          width: paneSize.width,
          // aspect-ratio keeps the pane shaped to the source image even if it
          // has to shrink below the requested width on a narrow viewport.
          aspectRatio: `${paneSize.width} / ${paneSize.height}`,
          maxWidth: "100%",
        }}
      >
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          cropSize={cropSize}
          cropShape="rect"
          showGrid={SHOW_GRID}
          objectFit={OBJECT_FIT}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          zoomSpeed={0.5}
          restrictPosition={restrictPosition}
          transform={transform}
          onCropChange={onCropChange}
          onZoomChange={onZoomChange}
          onRotationChange={onRotationChange}
          onCropComplete={handleCropComplete}
        />
      </div>
      <div className="grid gap-3">
        <div className="flex items-center gap-3">
          <span className="w-14 text-xs text-foreground-muted">Zoom</span>
          <Slider
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={ZOOM_STEP}
            value={[zoom]}
            onValueChange={(value) =>
              onZoomChange(
                clamp(readSliderValue(value, MIN_ZOOM), MIN_ZOOM, MAX_ZOOM)
              )
            }
            className="flex-1"
          />
        </div>
        <div
          role="group"
          aria-label="Crop transform controls"
          className="flex items-center gap-1"
        >
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Rotate 90° left"
            title="Rotate 90° left"
            onClick={() => onRotationChange(normalizeRotation(rotation - 90))}
          >
            <RotateCcw />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Rotate 90° right"
            title="Rotate 90° right"
            onClick={() => onRotationChange(normalizeRotation(rotation + 90))}
          >
            <RotateCw />
          </Button>
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          <Button
            type="button"
            variant={flipX ? "primary" : "outline"}
            size="icon-sm"
            aria-label="Flip horizontally"
            aria-pressed={flipX}
            title="Flip horizontally"
            onClick={onFlipXToggle}
          >
            <FlipHorizontal />
          </Button>
          <Button
            type="button"
            variant={flipY ? "primary" : "outline"}
            size="icon-sm"
            aria-label="Flip vertically"
            aria-pressed={flipY}
            title="Flip vertically"
            onClick={onFlipYToggle}
          >
            <FlipVertical />
          </Button>
        </div>
      </div>
    </>
  )
}

export interface ImageCropDialogProps {
  file: File | null
  mode: ImageCropMode
  onConfirm: (blob: Blob) => void
  onCancel: () => void
}

export function ImageCropDialog({
  file,
  mode,
  onConfirm,
  onCancel,
}: ImageCropDialogProps) {
  const cfg = CONFIG[mode]
  const [imageMeta, setImageMeta] = React.useState<{
    src: string
    width: number
    height: number
  } | null>(null)
  const [crop, setCrop] = React.useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = React.useState(1)
  const [rotation, setRotation] = React.useState(0)
  const [flipX, setFlipX] = React.useState(false)
  const [flipY, setFlipY] = React.useState(false)
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(
    null
  )
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!file) {
      setImageMeta(null)
      return
    }

    const url = URL.createObjectURL(file)
    let cancelled = false

    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setRotation(0)
    setFlipX(false)
    setFlipY(false)
    setCroppedAreaPixels(null)
    setError(null)
    setImageMeta(null)

    loadImage(url)
      .then((img) => {
        if (cancelled) return
        setImageMeta({
          src: url,
          width: img.naturalWidth,
          height: img.naturalHeight,
        })
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the image")
      })

    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
    }
  }, [file])

  const paneSize = imageMeta
    ? computePaneSize(imageMeta.width, imageMeta.height)
    : null
  const ready = !!imageMeta && !!croppedAreaPixels
  const open = !!file
  const isPristine =
    zoom === 1 &&
    rotation === 0 &&
    !flipX &&
    !flipY &&
    crop.x === 0 &&
    crop.y === 0

  function handleReset() {
    setZoom(1)
    setRotation(0)
    setFlipX(false)
    setFlipY(false)
    setCrop({ x: 0, y: 0 })
  }

  async function handleSave() {
    if (!imageMeta || !croppedAreaPixels) return
    setSaving(true)
    setError(null)
    try {
      const blob = await renderCrop({
        src: imageMeta.src,
        area: croppedAreaPixels,
        rotation,
        flip: { horizontal: flipX, vertical: flipY },
        output: cfg.output,
      })
      onConfirm(blob)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the crop"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel()
      }}
    >
      <DrawerContent
        className="max-h-[85vh] overflow-hidden bg-surface"
        style={{
          maxWidth: paneSize
            ? paneSize.width + DIALOG_HORIZONTAL_PADDING
            : FALLBACK_DIALOG_WIDTH,
        }}
        aria-describedby={undefined}
      >
        <div className="shrink-0 px-6 pt-2 pb-4">
          <DrawerTitle className="text-lg leading-tight font-semibold tracking-[var(--tracking-tight)] text-foreground">
            {cfg.title}
          </DrawerTitle>
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4">
          {imageMeta && paneSize ? (
            <ImageCropperView
              src={imageMeta.src}
              aspect={cfg.aspect}
              paneSize={paneSize}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              flipX={flipX}
              flipY={flipY}
              restrictPosition={cfg.restrictPosition}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onFlipXToggle={() => setFlipX((value) => !value)}
              onFlipYToggle={() => setFlipY((value) => !value)}
              onCropAreaChange={setCroppedAreaPixels}
            />
          ) : (
            <div className="flex h-72 items-center justify-center text-sm text-foreground-muted">
              {error ? "Couldn't load the image" : "Loading image…"}
            </div>
          )}
          {error && imageMeta ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DrawerFooter className="mt-0 shrink-0 flex-row items-center justify-between px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving || isPristine || !imageMeta}
            onClick={handleReset}
          >
            Reset
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={saving || !ready}
              onClick={handleSave}
            >
              {saving ? "Saving…" : "Apply"}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
