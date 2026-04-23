import * as React from "react"
import { AlertCircleIcon, PlusIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Separator } from "@workspace/ui/components/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/components/sonner"
import { Switch } from "@workspace/ui/components/switch"

import {
  ENCODER_CODECS,
  ENCODER_HEIGHT_MAX,
  ENCODER_HEIGHT_MIN,
  ENCODER_HEIGHT_SUGGESTIONS,
  ENCODER_HWACCELS,
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  type AdminEncoderVariant,
  type AdminRuntimeConfig,
  type EncoderCodec,
  type EncoderHwaccel,
} from "@workspace/api"

import { api } from "@/lib/api"
import { EncoderPresetField } from "./encoder-preset-field"
import { IntInput, VariantRow } from "./encoder-variant-row"
import {
  HWACCEL_LABEL,
  QUALITY_LABEL,
  normalizeGlobalPreset,
  normalizeVariantPreset,
} from "./shared"

type EncoderConfigCardProps = {
  encoder: AdminEncoderConfig
  onChange: (next: AdminRuntimeConfig) => void
}

export function EncoderConfigCard({
  encoder,
  onChange,
}: EncoderConfigCardProps) {
  const [form, setForm] = React.useState<AdminEncoderConfig>(encoder)
  const [pending, setPending] = React.useState(false)
  const [caps, setCaps] = React.useState<AdminEncoderCapabilities | null>(null)
  const [capsError, setCapsError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setForm(encoder)
  }, [encoder])

  function resetForm() {
    setForm(encoder)
  }

  React.useEffect(() => {
    let cancelled = false
    api.admin
      .fetchEncoderCapabilities()
      .then((next) => {
        if (!cancelled) setCaps(next)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setCapsError(
          cause instanceof Error
            ? cause.message
            : "Couldn't probe ffmpeg capabilities"
        )
      })
    return () => {
      cancelled = true
    }
  }, [])

  function set<K extends keyof AdminEncoderConfig>(
    key: K,
    value: AdminEncoderConfig[K]
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setEncoderCombo(
    nextHwaccel: EncoderHwaccel,
    nextCodec: EncoderCodec
  ) {
    setForm((f) => ({
      ...f,
      hwaccel: nextHwaccel,
      codec: nextCodec,
      preset: normalizeGlobalPreset(nextHwaccel, nextCodec, f.preset),
      variants: f.variants.map((variant) => ({
        ...variant,
        preset: normalizeVariantPreset(
          nextHwaccel,
          variant.codec ?? nextCodec,
          variant.preset
        ),
      })),
    }))
  }

  function updateVariant(index: number, next: AdminEncoderVariant) {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v, i) => (i === index ? next : v)),
    }))
  }

  function removeVariant(index: number) {
    setForm((f) => ({
      ...f,
      variants: f.variants.filter((_, i) => i !== index),
    }))
  }

  function moveVariant(index: number, direction: -1 | 1) {
    setForm((f) => {
      const target = index + direction
      if (target < 0 || target >= f.variants.length) return f
      const next = [...f.variants]
      const [moved] = next.splice(index, 1)
      if (!moved) return f
      next.splice(target, 0, moved)
      return { ...f, variants: next }
    })
  }

  function setDefaultVariant(index: number) {
    setForm((f) => {
      if (index <= 0 || index >= f.variants.length) return f
      const next = [...f.variants]
      const [selected] = next.splice(index, 1)
      if (!selected) return f
      next.unshift(selected)
      return { ...f, variants: next }
    })
  }

  function addVariant() {
    setForm((f) => {
      const used = new Set(f.variants.map((v) => v.height))
      const suggestion = [...ENCODER_HEIGHT_SUGGESTIONS]
        .reverse()
        .find((h) => !used.has(h))
      let next: number
      if (suggestion !== undefined) {
        next = suggestion
      } else if (f.variants.length === 0) {
        next = 1080
      } else {
        const smallest = Math.min(...f.variants.map((v) => v.height))
        next = Math.max(ENCODER_HEIGHT_MIN, Math.floor(smallest / 2 / 2) * 2)
      }
      return {
        ...f,
        variants: [...f.variants, { height: next }],
      }
    })
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    if (form.variants.length === 0) {
      toast.error("Add at least one variant.")
      return
    }
    const heights = form.variants.map((v) => v.height)
    if (new Set(heights).size !== heights.length) {
      toast.error("Variants must have unique heights.")
      return
    }
    for (const h of heights) {
      if (
        !Number.isInteger(h) ||
        h < ENCODER_HEIGHT_MIN ||
        h > ENCODER_HEIGHT_MAX ||
        h % 2 !== 0
      ) {
        toast.error(
          `Variant heights must be even integers between ${ENCODER_HEIGHT_MIN} and ${ENCODER_HEIGHT_MAX}.`
        )
        return
      }
    }
    setPending(true)
    try {
      const next = await api.admin.updateEncoderConfig(form)
      onChange(next)
      toast.success("Encoder updated")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update encoder"
      )
    } finally {
      setPending(false)
    }
  }

  const currentCombo = caps?.available[form.hwaccel]
  const currentComboMissing =
    caps !== null && currentCombo !== undefined && !currentCombo[form.codec]
  // Heights that appear in more than one rung — surfaced inline on each
  // offending row so the admin sees the clash without hitting submit.
  const duplicateHeights = React.useMemo(() => {
    const counts = new Map<number, number>()
    for (const v of form.variants) {
      counts.set(v.height, (counts.get(v.height) ?? 0) + 1)
    }
    const dupes = new Set<number>()
    for (const [h, count] of counts) {
      if (count > 1) dupes.add(h)
    }
    return dupes
  }, [form.variants])
  // Ladder is capped at six rungs on the server; mirror that here so the
  // add button disables at the same boundary (no silent server rejection).
  const canAddVariant = form.variants.length < 6
  const isDirty = JSON.stringify(form) !== JSON.stringify(encoder)
  const hasInvalidPreset =
    form.preset.trim() === "" ||
    form.variants.some(
      (variant) => variant.preset !== undefined && variant.preset.trim() === ""
    )
  const hasInvalidHeight = form.variants.some(
    (variant) =>
      !Number.isInteger(variant.height) ||
      variant.height < ENCODER_HEIGHT_MIN ||
      variant.height > ENCODER_HEIGHT_MAX ||
      variant.height % 2 !== 0
  )
  const canSubmit =
    isDirty &&
    !pending &&
    !hasInvalidPreset &&
    !hasInvalidHeight &&
    duplicateHeights.size === 0

  return (
    <form onSubmit={onSubmit}>
      <Card size="sm">
        <CardHeader>
          <div>
            <CardTitle>Encoder</CardTitle>
            <CardDescription>
              Encoder, codec, and variant ladder for new encode jobs.
            </CardDescription>
          </div>
        </CardHeader>

        <fieldset disabled={pending} className="contents">
        <CardContent className="flex flex-col gap-3">
          {capsError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{capsError}</span>
            </div>
          ) : null}

          {caps && !caps.ffmpegOk ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                ffmpeg isn&rsquo;t reachable on the server. Encodes will fail
                until the binary is on PATH (or <code>FFMPEG_BIN</code> points
                at it).
              </span>
            </div>
          ) : null}

          {caps?.ffmpegVersion ? (
            <p className="text-xs text-muted-foreground">
              Detected: <span className="font-mono">{caps.ffmpegVersion}</span>
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="encoder-hwaccel">Encoder</FieldLabel>
              <Select
                value={form.hwaccel}
                onValueChange={(value) =>
                  setEncoderCombo(value as EncoderHwaccel, form.codec)
                }
              >
                <SelectTrigger id="encoder-hwaccel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  {ENCODER_HWACCELS.map((hw) => {
                    const row = caps?.available[hw]
                    const anyCodec = row ? row.h264 || row.hevc : true
                    return (
                      <SelectItem key={hw} value={hw} disabled={!anyCodec}>
                        {HWACCEL_LABEL[hw]}
                        {row && !anyCodec ? " — unavailable" : ""}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <FieldDescription className="text-xs leading-snug">
                Pick your desired encoder. Make sure your GPU and ffmpeg build
                support the selected codec. If not, pick a software encoder.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="encoder-codec">Codec</FieldLabel>
              <Select
                value={form.codec}
                onValueChange={(value) =>
                  setEncoderCombo(form.hwaccel, value as EncoderCodec)
                }
              >
                <SelectTrigger id="encoder-codec" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  {ENCODER_CODECS.map((codec) => {
                    const ok = currentCombo ? currentCombo[codec] : true
                    return (
                      <SelectItem key={codec} value={codec} disabled={!ok}>
                        {codec.toUpperCase()}
                        {currentCombo && !ok ? " — unavailable" : ""}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              {currentComboMissing ? (
                <FieldDescription className="text-xs leading-snug text-destructive">
                  This combination isn&rsquo;t available in the host&rsquo;s
                  ffmpeg build. Encodes will fail.
                </FieldDescription>
              ) : null}
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="encoder-quality">
                Quality ({QUALITY_LABEL[form.hwaccel]})
              </FieldLabel>
              <IntInput
                id="encoder-quality"
                min={0}
                max={51}
                value={form.quality}
                onCommit={(next) => set("quality", next)}
              />
              <FieldDescription className="text-xs leading-snug">
                0–51, lower = higher quality. 23 is a good default for
                H.264/H.265; AV1 sits around 20–28. Hardware backends typically
                need slightly higher values.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="encoder-preset" required>
                Preset
              </FieldLabel>
              <EncoderPresetField
                id="encoder-preset"
                value={form.preset}
                hwaccel={form.hwaccel}
                codec={form.codec}
                required
                onChange={(next) => set("preset", next ?? "")}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="encoder-audio-bitrate">
                Audio bitrate (kbps)
              </FieldLabel>
              <IntInput
                id="encoder-audio-bitrate"
                min={64}
                max={256}
                step={8}
                value={form.audioBitrateKbps}
                onCommit={(next) => set("audioBitrateKbps", next)}
              />
              <FieldDescription className="text-xs leading-snug">
                AAC stereo. 128 is fine for game/voice; ~160 for music-heavy
                content. Higher is wasted bits.
              </FieldDescription>
            </Field>
          </div>

          {form.hwaccel === "qsv" ? (
            <Field>
              <FieldLabel htmlFor="encoder-qsv-device" required>
                QSV device
              </FieldLabel>
              <Input
                id="encoder-qsv-device"
                value={form.qsvDevice}
                required
                onChange={(e) => set("qsvDevice", e.target.value)}
                placeholder="/dev/dri/renderD128"
              />
              <FieldDescription className="text-xs leading-snug">
                Passed to ffmpeg as QSV&rsquo;s <code>child_device</code>. Use a
                DRM render node on Linux or an adapter index on Windows.
              </FieldDescription>
            </Field>
          ) : null}

          {form.hwaccel === "vaapi" ? (
            <Field>
              <FieldLabel htmlFor="encoder-vaapi-device" required>
                VA-API device
              </FieldLabel>
              <Input
                id="encoder-vaapi-device"
                value={form.vaapiDevice}
                required
                onChange={(e) => set("vaapiDevice", e.target.value)}
                placeholder="/dev/dri/renderD128"
              />
              <FieldDescription className="text-xs leading-snug">
                Path to the DRM render node passed to ffmpeg&rsquo;s{" "}
                <code>-vaapi_device</code>. Only used when the backend is
                VA-API.
              </FieldDescription>
            </Field>
          ) : null}

          <Separator />

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-sm font-medium">Variant ladder</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addVariant}
                disabled={pending || !canAddVariant}
              >
                <PlusIcon />
                Add variant
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Star a rung to make it the default playback rendition. Heights
              above source are clamped. Per-rung fields override the values
              above.
            </p>

            <div className="flex items-center justify-between gap-3 border-b pb-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Expose source</div>
                <p className="text-xs text-muted-foreground">
                  Offer the original upload as an opt-in "Source" quality.
                </p>
              </div>
              <Switch
                checked={form.keepSource}
                onCheckedChange={(next) => set("keepSource", next)}
                aria-label="Keep source"
              />
            </div>

            <div className="divide-y">
              {form.variants.map((variant, index) => (
                <div key={`${index}-${variant.height}`} className="py-3 first:pt-0 last:pb-0">
                  <VariantRow
                    variant={variant}
                    index={index}
                    isDefault={index === 0}
                    globalConfig={form}
                    isDuplicate={duplicateHeights.has(variant.height)}
                    canMoveUp={index > 0}
                    canMoveDown={index < form.variants.length - 1}
                    canDelete={form.variants.length > 1}
                    onChange={(next) => updateVariant(index, next)}
                    onSetDefault={() => setDefaultVariant(index)}
                    onMoveUp={() => moveVariant(index, -1)}
                    onMoveDown={() => moveVariant(index, 1)}
                    onDelete={() => removeVariant(index)}
                  />
                </div>
              ))}
            </div>
          </div>
        </CardContent>

        <CardFooter>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetForm}
              disabled={pending || !isDirty}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
              {pending ? "Saving…" : "Save encoder"}
            </Button>
          </div>
        </CardFooter>
        </fieldset>
      </Card>
    </form>
  )
}
