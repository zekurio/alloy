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
import { Textarea } from "@workspace/ui/components/textarea"

import { type AdminEncoderVariant } from "@workspace/api"
import { LimitedInput } from "@/components/form/limited-field"
import { EncoderHeightField } from "./encoder-height-field"
import { clampInt } from "./shared"

type EncoderVariantDialogProps = {
  variant: AdminEncoderVariant | null
  isNew: boolean
  onSave: (variant: AdminEncoderVariant) => void
  onOpenChange: (open: boolean) => void
}

export function EncoderVariantDialog({
  variant,
  isNew,
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
                <LimitedInput
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
                  <FieldLabel htmlFor="variant-video-encoder">
                    Video encoder
                  </FieldLabel>
                  <Input
                    id="variant-video-encoder"
                    value={draft.encoder}
                    placeholder="libx264, h264_nvenc, hevc_vaapi"
                    onChange={(e) => set("encoder", e.target.value)}
                  />
                  <FieldDescription className="text-xs leading-snug">
                    Passed as <code>-c:v</code>. Leave blank to let ffmpeg pick.
                  </FieldDescription>
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

              <Field>
                <FieldLabel htmlFor="variant-hwaccel">
                  Hardware acceleration
                </FieldLabel>
                <Input
                  id="variant-hwaccel"
                  value={draft.hwaccel}
                  placeholder="cuda, qsv, vaapi"
                  onChange={(e) => set("hwaccel", e.target.value)}
                />
                <FieldDescription className="text-xs leading-snug">
                  Passed as <code>-hwaccel</code>. Leave blank for ffmpeg
                  defaults.
                </FieldDescription>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="variant-quality" required>
                    Quality
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
                    Passed as <code>-preset</code>. Leave blank to omit.
                  </FieldDescription>
                </Field>

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

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="variant-extra-input-args">
                    Extra input args
                  </FieldLabel>
                  <Textarea
                    id="variant-extra-input-args"
                    value={draft.extraInputArgs}
                    placeholder="-probesize 100M -analyzeduration 100M"
                    onChange={(e) => set("extraInputArgs", e.target.value)}
                  />
                  <FieldDescription className="text-xs leading-snug">
                    Inserted before <code>-i</code>.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="variant-extra-output-args">
                    Extra output args
                  </FieldLabel>
                  <Textarea
                    id="variant-extra-output-args"
                    value={draft.extraOutputArgs}
                    placeholder='-vf "scale=1280:-2,fps=60" -movflags +faststart'
                    onChange={(e) => set("extraOutputArgs", e.target.value)}
                  />
                  <FieldDescription className="text-xs leading-snug">
                    Inserted after generated video, audio, and muxing args.
                  </FieldDescription>
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
