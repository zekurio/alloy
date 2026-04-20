import * as React from "react"
import { AlertCircleIcon } from "lucide-react"

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
import { NativeSelect } from "@workspace/ui/components/native-select"
import { toast } from "@workspace/ui/components/sonner"

import {
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  type AdminRuntimeConfig,
  ENCODER_CODECS,
  ENCODER_HWACCELS,
  ENCODER_TARGET_HEIGHTS,
  fetchEncoderCapabilities,
  updateEncoderConfig,
  type EncoderCodec,
  type EncoderHwaccel,
  type EncoderTargetHeight,
} from "../../../lib/admin-api"
import {
  clampInt,
  HWACCEL_LABEL,
  PRESET_SUGGESTIONS,
  QUALITY_LABEL,
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

  React.useEffect(() => {
    let cancelled = false
    fetchEncoderCapabilities()
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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    try {
      const next = await updateEncoderConfig(form)
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

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Encoder</CardTitle>
            <CardDescription>
              Hardware backend, codec, and quality used for new encode jobs.
              Changes apply to the next job; in-flight encodes finish on the
              previous settings.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="encoder-hwaccel">Backend</FieldLabel>
              <NativeSelect
                id="encoder-hwaccel"
                className="w-full"
                value={form.hwaccel}
                onChange={(e) =>
                  set("hwaccel", e.target.value as EncoderHwaccel)
                }
              >
                {ENCODER_HWACCELS.map((hw) => {
                  const row = caps?.available[hw]
                  const anyCodec = row ? row.h264 || row.hevc : true
                  return (
                    <option key={hw} value={hw} disabled={!anyCodec}>
                      {HWACCEL_LABEL[hw]}
                      {row && !anyCodec ? " — unavailable" : ""}
                    </option>
                  )
                })}
              </NativeSelect>
              <FieldDescription>
                Software is the safe default. Hardware backends require a
                compatible GPU and an ffmpeg build with the matching encoder
                compiled in.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="encoder-codec">Codec</FieldLabel>
              <NativeSelect
                id="encoder-codec"
                className="w-full"
                value={form.codec}
                onChange={(e) => set("codec", e.target.value as EncoderCodec)}
              >
                {ENCODER_CODECS.map((codec) => {
                  const ok = currentCombo ? currentCombo[codec] : true
                  return (
                    <option key={codec} value={codec} disabled={!ok}>
                      {codec.toUpperCase()}
                      {currentCombo && !ok ? " — unavailable" : ""}
                    </option>
                  )
                })}
              </NativeSelect>
              {currentComboMissing ? (
                <FieldDescription className="text-destructive">
                  This combination isn&rsquo;t available in the host&rsquo;s
                  ffmpeg build. Encodes will fail.
                </FieldDescription>
              ) : null}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="encoder-quality">
                Quality ({QUALITY_LABEL[form.hwaccel]})
              </FieldLabel>
              <Input
                id="encoder-quality"
                type="number"
                min={0}
                max={51}
                step={1}
                required
                value={form.quality}
                onChange={(e) =>
                  set("quality", clampInt(e.target.value, 0, 51, form.quality))
                }
              />
              <FieldDescription>
                0–51, lower = higher quality. 23 is a reasonable default for
                H.264/H.265 software encoding; hardware backends usually want
                slightly higher numbers for the same visual quality.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="encoder-preset">Preset</FieldLabel>
              <Input
                id="encoder-preset"
                list="encoder-preset-suggestions"
                value={form.preset}
                required
                onChange={(e) => set("preset", e.target.value)}
                disabled={form.hwaccel === "vaapi"}
                placeholder={
                  form.hwaccel === "vaapi" ? "Ignored by VA-API" : ""
                }
              />
              <datalist id="encoder-preset-suggestions">
                {PRESET_SUGGESTIONS[form.hwaccel].map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <FieldDescription>
                Speed/quality knob. Suggestions reflect the current backend.
              </FieldDescription>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="encoder-target-height">
                Target height
              </FieldLabel>
              <NativeSelect
                id="encoder-target-height"
                className="w-full"
                value={String(form.targetHeight)}
                onChange={(e) =>
                  set(
                    "targetHeight",
                    Number(e.target.value) as EncoderTargetHeight
                  )
                }
              >
                {ENCODER_TARGET_HEIGHTS.map((h) => (
                  <option key={h} value={h}>
                    {h}p
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>
                Source clips taller than this are downscaled; shorter clips are
                left at their original height.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="encoder-audio-bitrate">
                Audio bitrate (kbps)
              </FieldLabel>
              <Input
                id="encoder-audio-bitrate"
                type="number"
                min={32}
                max={384}
                step={8}
                required
                value={form.audioBitrateKbps}
                onChange={(e) =>
                  set(
                    "audioBitrateKbps",
                    clampInt(e.target.value, 32, 384, form.audioBitrateKbps)
                  )
                }
              />
              <FieldDescription>
                AAC stereo. 128 kbps is fine for game/voice clips; bump to 192+
                for music-heavy content.
              </FieldDescription>
            </Field>
          </div>

          {form.hwaccel === "vaapi" ? (
            <Field>
              <FieldLabel htmlFor="encoder-vaapi-device">
                VA-API device
              </FieldLabel>
              <Input
                id="encoder-vaapi-device"
                value={form.vaapiDevice}
                required
                onChange={(e) => set("vaapiDevice", e.target.value)}
                placeholder="/dev/dri/renderD128"
              />
              <FieldDescription>
                Path to the DRM render node passed to ffmpeg&rsquo;s{" "}
                <code>-vaapi_device</code>. Only used when the backend is
                VA-API.
              </FieldDescription>
            </Field>
          ) : null}
        </CardContent>

        <CardFooter>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save encoder"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
