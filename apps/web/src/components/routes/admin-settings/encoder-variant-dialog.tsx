import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import {
  type AdminEncoderCapabilities,
  type AdminEncoderVariant,
  ENCODER_CODECS,
  ENCODER_HWACCELS,
  type EncoderCodec,
  type EncoderHwaccel,
} from "@workspace/api"
import { EncoderHeightField } from "./encoder-height-field"
import {
  clampInt,
  QUALITY_LABEL,
  ffmpegEncoderName,
} from "./shared"

type EncoderVariantDialogProps = {
  variant: AdminEncoderVariant | null
  isNew: boolean
  caps: AdminEncoderCapabilities | null
  qsvDevice: string
  vaapiDevice: string
  onDeviceChange: (key: "qsvDevice" | "vaapiDevice", value: string) => void
  onSave: (variant: AdminEncoderVariant) => void
  onOpenChange: (open: boolean) => void
}

type VideoEncoderOption = {
  value: string
  hwaccel: EncoderHwaccel
  codec: EncoderCodec
  label: string
  available: boolean
}

function videoEncoderValue(
  hwaccel: EncoderHwaccel,
  codec: EncoderCodec
): string {
  return `${hwaccel}:${codec}`
}

function parseVideoEncoderValue(value: string): {
  hwaccel: EncoderHwaccel
  codec: EncoderCodec
} | null {
  const [hwaccel, codec] = value.split(":")
  if (
    ENCODER_HWACCELS.includes(hwaccel as EncoderHwaccel) &&
    ENCODER_CODECS.includes(codec as EncoderCodec)
  ) {
    return { hwaccel: hwaccel as EncoderHwaccel, codec: codec as EncoderCodec }
  }
  return null
}

function videoEncoderOptions(
  caps: AdminEncoderCapabilities | null
): VideoEncoderOption[] {
  return ENCODER_HWACCELS.flatMap((hwaccel) =>
    ENCODER_CODECS.map((codec) => {
      const available = caps?.available[hwaccel]?.[codec] ?? true
      return {
        value: videoEncoderValue(hwaccel, codec),
        hwaccel,
        codec,
        label: ffmpegEncoderName(hwaccel, codec),
        available,
      }
    })
  )
}

export function EncoderVariantDialog({
  variant,
  isNew,
  caps,
  qsvDevice,
  vaapiDevice,
  onDeviceChange,
  onSave,
  onOpenChange,
}: EncoderVariantDialogProps) {
  const [draft, setDraft] = React.useState<AdminEncoderVariant | null>(null)
  const [qualityDraft, setQualityDraft] = React.useState("")
  const [audioDraft, setAudioDraft] = React.useState("")
  const prevVariantRef = React.useRef<AdminEncoderVariant | null>(null)

  React.useEffect(() => {
    if (variant !== null && prevVariantRef.current === null) {
      setDraft({ ...variant })
      setQualityDraft(String(variant.quality))
      setAudioDraft(String(variant.audioBitrateKbps))
    }
    if (variant === null) {
      setDraft(null)
      setQualityDraft("")
      setAudioDraft("")
    }
    prevVariantRef.current = variant
  }, [variant])

  function set<K extends keyof AdminEncoderVariant>(
    key: K,
    value: AdminEncoderVariant[K]
  ) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }

  function setVideoEncoder(
    nextHwaccel: EncoderHwaccel,
    nextCodec: EncoderCodec
  ) {
    setDraft((d) =>
      d
        ? {
            ...d,
            hwaccel: nextHwaccel,
            codec: nextCodec,
          }
        : d
    )
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!draft) return
    const quality = clampInt(qualityDraft, 0, 51, draft.quality)
    const audioBitrateKbps = clampInt(
      audioDraft,
      64,
      256,
      draft.audioBitrateKbps
    )
    onSave({ ...draft, quality, audioBitrateKbps })
  }

  const encoderOptions = videoEncoderOptions(caps)
  const selectedEncoderMissing =
    draft !== null &&
    caps !== null &&
    !encoderOptions.some(
      (option) =>
        option.hwaccel === draft.hwaccel &&
        option.codec === draft.codec &&
        option.available
    )

  return (
    <Dialog open={variant !== null} onOpenChange={onOpenChange}>
      <DialogContent variant="secondary" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add variant" : "Edit variant"}</DialogTitle>
        </DialogHeader>

        {draft ? (
          <form id="encoder-variant-form" onSubmit={handleSubmit}>
            <DialogBody className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="variant-name" required>
                  Variant name
                </FieldLabel>
                <Input
                  id="variant-name"
                  value={draft.name}
                  required
                  maxLength={64}
                  placeholder="1080p H.264 web"
                  aria-invalid={draft.name.trim() === "" || undefined}
                  onChange={(e) => set("name", e.target.value)}
                />
                <FieldDescription className="text-xs leading-snug">
                  Used as the player label and in the stored MP4 filename.
                </FieldDescription>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="variant-video-encoder" required>
                    Video encoder
                  </FieldLabel>
                  <Select
                    value={videoEncoderValue(draft.hwaccel, draft.codec)}
                    onValueChange={(value) => {
                      if (value === null) return
                      const parsed = parseVideoEncoderValue(value)
                      if (!parsed) return
                      setVideoEncoder(parsed.hwaccel, parsed.codec)
                    }}
                  >
                    <SelectTrigger
                      id="variant-video-encoder"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" alignItemWithTrigger={false}>
                      {encoderOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          disabled={!option.available}
                        >
                          {option.label}
                          {!option.available ? " - unavailable" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedEncoderMissing ? (
                    <FieldDescription className="text-xs leading-snug text-destructive">
                      Unavailable in the host ffmpeg build.
                    </FieldDescription>
                  ) : null}
                </Field>

                <Field>
                  <FieldLabel htmlFor="variant-height" required>
                    Vertical resolution
                  </FieldLabel>
                  <EncoderHeightField
                    id="variant-height"
                    value={draft.height}
                    showDescription={false}
                    onChange={(next) => set("height", next)}
                  />
                </Field>
              </div>

              {draft.hwaccel === "qsv" ? (
                <Field>
                  <FieldLabel htmlFor="variant-qsv-device" required>
                    QSV device
                  </FieldLabel>
                  <Input
                    id="variant-qsv-device"
                    value={qsvDevice}
                    required
                    placeholder="/dev/dri/renderD128"
                    onChange={(e) =>
                      onDeviceChange("qsvDevice", e.target.value)
                    }
                  />
                  <FieldDescription className="text-xs leading-snug">
                    Shared by every QSV variant and passed to ffmpeg as{" "}
                    <code>child_device</code>.
                  </FieldDescription>
                </Field>
              ) : null}

              {draft.hwaccel === "vaapi" ? (
                <Field>
                  <FieldLabel htmlFor="variant-vaapi-device" required>
                    VA-API device
                  </FieldLabel>
                  <Input
                    id="variant-vaapi-device"
                    value={vaapiDevice}
                    required
                    placeholder="/dev/dri/renderD128"
                    onChange={(e) =>
                      onDeviceChange("vaapiDevice", e.target.value)
                    }
                  />
                  <FieldDescription className="text-xs leading-snug">
                    Shared by every VA-API variant and passed to ffmpeg with{" "}
                    <code>-vaapi_device</code>.
                  </FieldDescription>
                </Field>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="variant-quality" required>
                    Quality ({QUALITY_LABEL[draft.hwaccel]})
                  </FieldLabel>
                  <Input
                    id="variant-quality"
                    type="number"
                    min={0}
                    max={51}
                    step={1}
                    value={qualityDraft}
                    required
                    onChange={(e) => {
                      const raw = e.target.value
                      setQualityDraft(raw)
                      if (raw === "") return
                      set("quality", clampInt(raw, 0, 51, draft.quality))
                    }}
                    onBlur={() => {
                      if (qualityDraft === "") {
                        setQualityDraft(String(draft.quality))
                        return
                      }
                      const next = clampInt(qualityDraft, 0, 51, draft.quality)
                      set("quality", next)
                      setQualityDraft(String(next))
                    }}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {draft.hwaccel !== "vaapi" ? (
                  <Field>
                    <FieldLabel htmlFor="variant-preset">Preset</FieldLabel>
                    <Input
                      id="variant-preset"
                      value={draft.preset ?? ""}
                      placeholder="Optional ffmpeg preset"
                      onChange={(e) => {
                        const next = e.target.value
                        set("preset", next.trim() === "" ? undefined : next)
                      }}
                    />
                    <FieldDescription className="text-xs leading-snug">
                      Omit to let ffmpeg choose its encoder default.
                    </FieldDescription>
                  </Field>
                ) : null}

                <Field>
                  <FieldLabel htmlFor="variant-audio" required>
                    Audio bitrate (kbps)
                  </FieldLabel>
                  <Input
                    id="variant-audio"
                    type="number"
                    min={64}
                    max={256}
                    step={8}
                    value={audioDraft}
                    required
                    onChange={(e) => {
                      const raw = e.target.value
                      setAudioDraft(raw)
                      if (raw === "") return
                      set(
                        "audioBitrateKbps",
                        clampInt(raw, 64, 256, draft.audioBitrateKbps)
                      )
                    }}
                    onBlur={() => {
                      if (audioDraft === "") {
                        setAudioDraft(String(draft.audioBitrateKbps))
                        return
                      }
                      const next = clampInt(
                        audioDraft,
                        64,
                        256,
                        draft.audioBitrateKbps
                      )
                      set("audioBitrateKbps", next)
                      setAudioDraft(String(next))
                    }}
                  />
                </Field>
              </div>
            </DialogBody>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {isNew ? "Add variant" : "Save variant"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
