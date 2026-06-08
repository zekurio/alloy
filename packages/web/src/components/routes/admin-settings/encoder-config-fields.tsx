import {
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  ENCODER_TONEMAPPING_ALGORITHMS,
  ENCODER_TONEMAPPING_MODES,
  ENCODER_TONEMAPPING_RANGES,
  type EncoderCodec,
  type EncoderTonemappingAlgorithm,
  type EncoderTonemappingMode,
  type EncoderTonemappingRange,
} from "alloy-api"
import { Field, FieldLabel } from "alloy-ui/components/field"
import { Input } from "alloy-ui/components/input"

const LIVE_CODEC_DISPLAY_ORDER: readonly EncoderCodec[] = [
  "av1",
  "hevc",
  "h264",
]

const LIVE_CODEC_LABELS: Record<EncoderCodec, string> = {
  av1: "AV1",
  hevc: "HEVC",
  h264: "H.264",
}

export const TONEMAPPING_ALGORITHM_LABELS: Record<
  EncoderTonemappingAlgorithm,
  string
> = {
  none: "None",
  linear: "Linear",
  gamma: "Gamma",
  clip: "Clip",
  reinhard: "Reinhard",
  hable: "Hable",
  mobius: "Mobius",
  bt2390: "BT.2390",
}

export const TONEMAPPING_MODE_LABELS: Record<EncoderTonemappingMode, string> = {
  auto: "Auto",
  max: "Max",
  rgb: "RGB",
  lum: "Luminance",
  itp: "ICtCp",
}

export const TONEMAPPING_RANGE_LABELS: Record<EncoderTonemappingRange, string> =
  {
    auto: "Auto",
    limited: "Limited",
    full: "Full",
  }

export function CodecAvailability({
  caps,
  hwaccel,
  ffmpegError,
}: {
  caps: AdminEncoderCapabilities | null
  hwaccel: AdminEncoderConfig["hwaccel"]
  ffmpegError: string | null
}) {
  const availability = caps?.available[hwaccel] ?? null
  const unavailable = ffmpegError !== null || caps?.ffmpegOk === false

  return (
    <div className="flex flex-wrap gap-2">
      {LIVE_CODEC_DISPLAY_ORDER.map((codec) => {
        const supported = Boolean(availability?.[codec])
        const pending = !caps && !ffmpegError
        return (
          <span
            key={codec}
            data-supported={supported ? "true" : "false"}
            data-pending={pending ? "true" : "false"}
            className="border-border bg-surface-raised text-foreground-muted data-[supported=true]:border-success/35 data-[supported=true]:bg-success/10 data-[supported=true]:text-success data-[supported=false]:data-[pending=false]:border-border data-[supported=false]:data-[pending=false]:bg-surface-sunken data-[supported=false]:data-[pending=false]:text-foreground-faint inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium data-[pending=true]:opacity-60"
          >
            {LIVE_CODEC_LABELS[codec]}
            {unavailable || (!pending && !supported) ? " unavailable" : ""}
          </span>
        )
      })}
    </div>
  )
}

export function ToneMappingNumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  hint,
  nullable = false,
  onChange,
}: {
  id: string
  label: string
  value: number | null
  min: number
  max: number
  step: number
  hint?: string
  nullable?: boolean
  onChange: (value: number | null) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value
          if (nullable && raw.trim() === "") {
            onChange(null)
            return
          }
          const next = Number(raw)
          if (!Number.isFinite(next)) return
          onChange(Math.min(max, Math.max(min, next)))
        }}
      />
      {hint ? <p className="text-foreground-muted text-xs">{hint}</p> : null}
    </Field>
  )
}

export function isTonemappingAlgorithm(
  value: string | number | null,
): value is EncoderTonemappingAlgorithm {
  return (
    typeof value === "string" &&
    ENCODER_TONEMAPPING_ALGORITHMS.includes(
      value as EncoderTonemappingAlgorithm,
    )
  )
}

export function isTonemappingMode(
  value: string | number | null,
): value is EncoderTonemappingMode {
  return (
    typeof value === "string" &&
    ENCODER_TONEMAPPING_MODES.includes(value as EncoderTonemappingMode)
  )
}

export function isTonemappingRange(
  value: string | number | null,
): value is EncoderTonemappingRange {
  return (
    typeof value === "string" &&
    ENCODER_TONEMAPPING_RANGES.includes(value as EncoderTonemappingRange)
  )
}
