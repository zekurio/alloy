import * as React from "react"
import Cropper from "react-easy-crop"
import type { Area } from "react-easy-crop"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Slider } from "@workspace/ui/components/slider"

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.addEventListener("load", () => resolve(img))
    img.addEventListener("error", (err) => reject(err))
    img.crossOrigin = "anonymous"
    img.src = url
  })
}

async function cropImage(
  imageSrc: string,
  crop: Area,
  outputType = "image/jpeg",
  quality = 0.92
): Promise<Blob> {
  const img = await createImage(imageSrc)
  const canvas = document.createElement("canvas")
  canvas.width = crop.width
  canvas.height = crop.height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  )
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("Canvas toBlob returned null"))
      },
      outputType,
      quality
    )
  })
}

export type ImageCropMode = "avatar" | "banner"

const CONFIG: Record<
  ImageCropMode,
  { aspect: number; title: string; cropShape: "round" | "rect" }
> = {
  avatar: { aspect: 1, title: "Crop avatar", cropShape: "rect" },
  banner: { aspect: 4, title: "Crop banner", cropShape: "rect" },
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
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)
  const [crop, setCrop] = React.useState({ x: 0, y: 0 })
  const [zoom, setZoom] = React.useState(1)
  const [croppedArea, setCroppedArea] = React.useState<Area | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!file) {
      setImageSrc(null)
      return
    }
    const url = URL.createObjectURL(file)
    setImageSrc(url)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const open = !!imageSrc

  async function handleSave() {
    if (!imageSrc || !croppedArea) return
    setSaving(true)
    try {
      const blob = await cropImage(imageSrc, croppedArea)
      onConfirm(blob)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{cfg.title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {imageSrc ? (
            <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={cfg.aspect}
                cropShape={cfg.cropShape}
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_croppedArea, croppedAreaPixels) =>
                  setCroppedArea(croppedAreaPixels)
                }
              />
            </div>
          ) : null}
          <div className="flex items-center gap-3 px-1">
            <span className="text-xs text-foreground-muted">Zoom</span>
            <Slider
              min={1}
              max={3}
              step={0.01}
              value={[zoom]}
              onValueChange={(value) =>
                setZoom(Array.isArray(value) ? (value[0] ?? 1) : value)
              }
              className="flex-1"
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={saving || !croppedArea}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
