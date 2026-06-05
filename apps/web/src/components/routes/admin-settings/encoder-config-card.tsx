import { useQuery } from "@tanstack/react-query"
import {
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  type AdminRuntimeConfig,
  ENCODER_CODECS,
  ENCODER_HWACCELS,
  ENCODER_TONEMAPPING_ALGORITHMS,
  ENCODER_TONEMAPPING_MODES,
  ENCODER_TONEMAPPING_RANGES,
  type EncoderCodec,
  type EncoderTonemappingAlgorithm,
  type EncoderTonemappingMode,
  type EncoderTonemappingRange,
} from "@workspace/api"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Section,
  SectionContent,
  SectionFooter,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { AlertTriangleIcon, SaveIcon } from "lucide-react"
import * as React from "react"

import { adminEncoderCapabilitiesQueryOptions } from "@/lib/admin-query-keys"
import { errorMessage } from "@/lib/error-message"

import {
  encoderConfigsEqual,
  HWACCEL_LABELS,
  isEncoderHwaccel,
  saveEncoderConfig,
} from "./encoder-config-helpers"
import { FfmpegBadge } from "./encoder-ffmpeg-badge"
import { FormGroup } from "./form-group"

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

const TONEMAPPING_ALGORITHM_LABELS: Record<
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

const TONEMAPPING_MODE_LABELS: Record<EncoderTonemappingMode, string> = {
  auto: "Auto",
  max: "Max",
  rgb: "RGB",
  lum: "Luminance",
  itp: "ICtCp",
}

const TONEMAPPING_RANGE_LABELS: Record<EncoderTonemappingRange, string> = {
  auto: "Auto",
  limited: "Limited",
  full: "Full",
}

type EncoderConfigCardProps = {
  encoder: AdminEncoderConfig
  onChange: (next: AdminRuntimeConfig) => void
  /** Called after a successful save (or when submitted with no changes). */
  onSaved?: () => void
  /** Hide the footer action buttons (Cancel / Save). */
  hideActions?: boolean
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
  /** HTML `id` for the `<form>` element, useful for external submit buttons. */
  formId?: string
}

export function EncoderConfigCard({
  encoder,
  onChange,
  onSaved,
  hideActions,
  hideHeader,
  formId,
}: EncoderConfigCardProps) {
  const [form, setForm] = React.useState<AdminEncoderConfig>(encoder)
  const [pending, setPending] = React.useState(false)
  const capsQuery = useQuery(adminEncoderCapabilitiesQueryOptions())
  const caps = capsQuery.data ?? null
  const capsError = capsQuery.error
    ? errorMessage(capsQuery.error, "Couldn't probe ffmpeg capabilities")
    : null

  React.useEffect(() => {
    setForm(encoder)
  }, [encoder])

  function resetForm() {
    setForm(encoder)
  }

  function set<K extends keyof AdminEncoderConfig>(
    key: K,
    value: AdminEncoderConfig[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setTonemapping<K extends keyof AdminEncoderConfig["tonemapping"]>(
    key: K,
    value: AdminEncoderConfig["tonemapping"][K],
  ) {
    setForm((f) => ({
      ...f,
      tonemapping: {
        ...f.tonemapping,
        [key]: value,
      },
    }))
  }

  function setVppTonemapping<
    K extends keyof AdminEncoderConfig["tonemapping"]["vpp"],
  >(key: K, value: AdminEncoderConfig["tonemapping"]["vpp"][K]) {
    setForm((f) => ({
      ...f,
      tonemapping: {
        ...f.tonemapping,
        vpp: {
          ...f.tonemapping.vpp,
          [key]: value,
        },
      },
    }))
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    if (!isDirty) {
      onSaved?.()
      return
    }
    await saveEncoderConfig({ form, onChange, setPending, onSaved })
  }

  const selectedDevice =
    form.hwaccel === "qsv"
      ? {
          key: "qsvDevice" as const,
          id: "encoder-qsv-device",
          label: "QSV device",
        }
      : form.hwaccel === "vaapi"
        ? {
            key: "vaapiDevice" as const,
            id: "encoder-vaapi-device",
            label: "VAAPI device",
          }
        : null

  const liveCodecUnavailable =
    form.enabled &&
    caps?.ffmpegOk &&
    !ENCODER_CODECS.some(
      (codec) => caps.available[form.hwaccel]?.[codec] ?? false,
    )
  const showQsvLowPower = form.hwaccel === "qsv"
  const isDirty = !encoderConfigsEqual(form, encoder)
  const canSubmit = isDirty && !pending && !liveCodecUnavailable

  return (
    <form id={formId} onSubmit={onSubmit}>
      <Section>
        {!hideHeader && (
          <SectionHeader>
            <SectionTitle>Live Transcoding</SectionTitle>
            <FfmpegBadge caps={caps} error={capsError} />
          </SectionHeader>
        )}

        <fieldset disabled={pending} className="contents">
          <SectionContent className="flex flex-col gap-0">
            <FormGroup
              title="Live playback"
              description="Used when a viewer picks a lower bitrate than the original."
            >
              {hideHeader && <FfmpegBadge caps={caps} error={capsError} />}
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="encoder-enabled">
                  Live transcoding
                </FieldLabel>
                <Switch
                  id="encoder-enabled"
                  checked={form.enabled}
                  onCheckedChange={(checked) => set("enabled", checked)}
                  aria-label="Enable live transcoding"
                />
              </div>
            </FormGroup>

            <FormGroup
              title="Hardware acceleration"
              description="GPU backend used for transcoding."
            >
              <Field>
                <FieldLabel htmlFor="encoder-hwaccel">Backend</FieldLabel>
                <Select
                  value={form.hwaccel}
                  onValueChange={(value) => {
                    if (isEncoderHwaccel(value)) set("hwaccel", value)
                  }}
                >
                  <SelectTrigger id="encoder-hwaccel" className="w-full">
                    <SelectValue>{HWACCEL_LABELS[form.hwaccel]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {ENCODER_HWACCELS.map((hwaccel) => (
                      <SelectItem key={hwaccel} value={hwaccel}>
                        {HWACCEL_LABELS[hwaccel]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {selectedDevice ? (
                <Field>
                  <FieldLabel htmlFor={selectedDevice.id}>
                    {selectedDevice.label}
                  </FieldLabel>
                  <Input
                    id={selectedDevice.id}
                    value={form[selectedDevice.key]}
                    placeholder="/dev/dri/renderD128"
                    onChange={(e) => set(selectedDevice.key, e.target.value)}
                  />
                </Field>
              ) : null}

              <CodecAvailability
                caps={caps}
                hwaccel={form.hwaccel}
                ffmpegError={capsError}
              />

              {liveCodecUnavailable ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    The detected ffmpeg build can't encode AV1, HEVC, or H.264{" "}
                    with {HWACCEL_LABELS[form.hwaccel]}.
                  </span>
                </div>
              ) : null}
            </FormGroup>

            {showQsvLowPower ? (
              <FormGroup>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="encoder-intel-low-power-h264">
                    H.264 low-power
                  </FieldLabel>
                  <Switch
                    id="encoder-intel-low-power-h264"
                    checked={form.intelLowPowerH264}
                    onCheckedChange={(checked) =>
                      set("intelLowPowerH264", checked)
                    }
                    aria-label="Enable Intel H.264 low-power encoding"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="encoder-intel-low-power-hevc">
                    HEVC low-power
                  </FieldLabel>
                  <Switch
                    id="encoder-intel-low-power-hevc"
                    checked={form.intelLowPowerHevc}
                    onCheckedChange={(checked) =>
                      set("intelLowPowerHevc", checked)
                    }
                    aria-label="Enable Intel HEVC low-power encoding"
                  />
                </div>
              </FormGroup>
            ) : null}

            <FormGroup
              title="Tone mapping"
              description="HDR to SDR conversion for live transcodes."
            >
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="encoder-tonemapping-enabled">
                  Tone mapping
                </FieldLabel>
                <Switch
                  id="encoder-tonemapping-enabled"
                  checked={form.tonemapping.enabled}
                  onCheckedChange={(checked) =>
                    setTonemapping("enabled", checked)
                  }
                  aria-label="Enable HDR tone mapping"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="encoder-tonemapping-algorithm">
                    Algorithm
                  </FieldLabel>
                  <Select
                    value={form.tonemapping.algorithm}
                    onValueChange={(value) => {
                      if (isTonemappingAlgorithm(value)) {
                        setTonemapping("algorithm", value)
                      }
                    }}
                  >
                    <SelectTrigger
                      id="encoder-tonemapping-algorithm"
                      className="w-full"
                    >
                      <SelectValue>
                        {
                          TONEMAPPING_ALGORITHM_LABELS[
                            form.tonemapping.algorithm
                          ]
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {ENCODER_TONEMAPPING_ALGORITHMS.map((algorithm) => (
                        <SelectItem key={algorithm} value={algorithm}>
                          {TONEMAPPING_ALGORITHM_LABELS[algorithm]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="encoder-tonemapping-mode">
                    Mode
                  </FieldLabel>
                  <Select
                    value={form.tonemapping.mode}
                    onValueChange={(value) => {
                      if (isTonemappingMode(value)) {
                        setTonemapping("mode", value)
                      }
                    }}
                  >
                    <SelectTrigger
                      id="encoder-tonemapping-mode"
                      className="w-full"
                    >
                      <SelectValue>
                        {TONEMAPPING_MODE_LABELS[form.tonemapping.mode]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {ENCODER_TONEMAPPING_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {TONEMAPPING_MODE_LABELS[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="encoder-tonemapping-range">
                    Range
                  </FieldLabel>
                  <Select
                    value={form.tonemapping.range}
                    onValueChange={(value) => {
                      if (isTonemappingRange(value)) {
                        setTonemapping("range", value)
                      }
                    }}
                  >
                    <SelectTrigger
                      id="encoder-tonemapping-range"
                      className="w-full"
                    >
                      <SelectValue>
                        {TONEMAPPING_RANGE_LABELS[form.tonemapping.range]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {ENCODER_TONEMAPPING_RANGES.map((range) => (
                        <SelectItem key={range} value={range}>
                          {TONEMAPPING_RANGE_LABELS[range]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <ToneMappingNumberField
                  id="encoder-tonemapping-desat"
                  label="Desat"
                  value={form.tonemapping.desat}
                  min={0}
                  max={10}
                  step={0.1}
                  onChange={(value) => {
                    if (value !== null) setTonemapping("desat", value)
                  }}
                />
                <ToneMappingNumberField
                  id="encoder-tonemapping-peak"
                  label="Peak"
                  value={form.tonemapping.peak}
                  min={0}
                  max={10_000}
                  step={1}
                  onChange={(value) => {
                    if (value !== null) setTonemapping("peak", value)
                  }}
                />
                <ToneMappingNumberField
                  id="encoder-tonemapping-param"
                  label="Param"
                  value={form.tonemapping.param}
                  min={0}
                  max={10}
                  step={0.1}
                  nullable
                  onChange={(value) => setTonemapping("param", value)}
                />
                <ToneMappingNumberField
                  id="encoder-tonemapping-threshold"
                  label="Threshold"
                  value={form.tonemapping.threshold}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) => {
                    if (value !== null) setTonemapping("threshold", value)
                  }}
                />
              </div>

              {form.hwaccel === "qsv" ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <FieldLabel htmlFor="encoder-tonemapping-vpp-enabled">
                      QSV VPP tone mapping
                    </FieldLabel>
                    <Switch
                      id="encoder-tonemapping-vpp-enabled"
                      checked={form.tonemapping.vpp.enabled}
                      onCheckedChange={(checked) =>
                        setVppTonemapping("enabled", checked)
                      }
                      aria-label="Enable QSV VPP tone mapping"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <ToneMappingNumberField
                      id="encoder-tonemapping-vpp-brightness"
                      label="VPP brightness"
                      value={form.tonemapping.vpp.brightness}
                      min={-100}
                      max={100}
                      step={1}
                      hint="Recommended 16"
                      onChange={(value) => {
                        if (value !== null) {
                          setVppTonemapping("brightness", value)
                        }
                      }}
                    />
                    <ToneMappingNumberField
                      id="encoder-tonemapping-vpp-contrast"
                      label="VPP contrast"
                      value={form.tonemapping.vpp.contrast}
                      min={0}
                      max={10}
                      step={0.1}
                      hint="Recommended 1"
                      onChange={(value) => {
                        if (value !== null) {
                          setVppTonemapping("contrast", value)
                        }
                      }}
                    />
                  </div>
                </>
              ) : null}
            </FormGroup>
          </SectionContent>

          {!hideActions && (
            <SectionFooter>
              <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
                <Button
                  className="flex-1 sm:flex-initial"
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetForm}
                  disabled={pending || !isDirty}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 sm:flex-initial"
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!canSubmit}
                >
                  <SaveIcon />
                  {pending ? "Saving..." : "Save"}
                </Button>
              </div>
            </SectionFooter>
          )}
        </fieldset>
      </Section>
    </form>
  )
}

function CodecAvailability({
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

function ToneMappingNumberField({
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

function isTonemappingAlgorithm(
  value: string | number | null,
): value is EncoderTonemappingAlgorithm {
  return (
    typeof value === "string" &&
    ENCODER_TONEMAPPING_ALGORITHMS.includes(
      value as EncoderTonemappingAlgorithm,
    )
  )
}

function isTonemappingMode(
  value: string | number | null,
): value is EncoderTonemappingMode {
  return (
    typeof value === "string" &&
    ENCODER_TONEMAPPING_MODES.includes(value as EncoderTonemappingMode)
  )
}

function isTonemappingRange(
  value: string | number | null,
): value is EncoderTonemappingRange {
  return (
    typeof value === "string" &&
    ENCODER_TONEMAPPING_RANGES.includes(value as EncoderTonemappingRange)
  )
}
