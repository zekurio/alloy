import { useQuery } from "@tanstack/react-query"
import {
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  type AdminRuntimeConfig,
  ENCODER_CODECS,
  ENCODER_HWACCELS,
  type EncoderCodec,
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
