import type {
  RecordingCodec,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"

import {
  DESKTOP_RECORDING_BITRATES,
  DESKTOP_RECORDING_ENCODERS,
  DESKTOP_RECORDING_FRAME_RATES,
  DESKTOP_RECORDING_RESOLUTIONS,
} from "./desktop-bridge"
import {
  asLiteral,
  asNumberLiteral,
  bitrateLabel,
  CODEC_LABELS,
  ENCODER_LABELS,
  gpuLabel,
  RESOLUTION_LABELS,
} from "./desktop-recording-helpers"

export function EncodingSettingsGrid({
  settings,
  status,
  busy,
  save,
}: {
  settings: RecordingSettings
  status: RecordingStatus
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  const gpus = gpuOptions(status.availableGpus, settings.gpu)
  const codecs = codecOptions(status.availableCodecs)
  const selectedCodecSupported = codecs.includes(settings.codec)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Field>
        <FieldLabel htmlFor="desktop-recording-resolution" className="text-xs">
          {tx("Resolution")}
        </FieldLabel>
        <Select
          value={settings.resolution}
          disabled={busy}
          onValueChange={(value) => {
            const resolution = asLiteral(value, DESKTOP_RECORDING_RESOLUTIONS)
            if (resolution) {
              void save(updateCustomQuality(settings, { resolution }))
            }
          }}
        >
          <SelectTrigger
            id="desktop-recording-resolution"
            size="sm"
            className="w-full"
          >
            <SelectValue>{RESOLUTION_LABELS[settings.resolution]}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {DESKTOP_RECORDING_RESOLUTIONS.map((resolution) => (
              <SelectItem key={resolution} value={resolution}>
                {RESOLUTION_LABELS[resolution]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor="desktop-recording-fps" className="text-xs">
          {tx("Frame rate")}
        </FieldLabel>
        <Select
          value={String(settings.fps)}
          disabled={busy}
          onValueChange={(value) => {
            const fps = asNumberLiteral(value, DESKTOP_RECORDING_FRAME_RATES)
            if (fps) void save(updateCustomQuality(settings, { fps }))
          }}
        >
          <SelectTrigger
            id="desktop-recording-fps"
            size="sm"
            className="w-full"
          >
            <SelectValue>
              {settings.fps} {tx("FPS")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {DESKTOP_RECORDING_FRAME_RATES.map((fps) => (
              <SelectItem key={fps} value={String(fps)}>
                {fps} {tx("FPS")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor="desktop-recording-bitrate" className="text-xs">
          {tx("Bitrate")}
        </FieldLabel>
        <Select
          value={settings.bitrate}
          disabled={busy}
          onValueChange={(value) => {
            const bitrate = asLiteral(value, DESKTOP_RECORDING_BITRATES)
            if (bitrate) void save(updateCustomQuality(settings, { bitrate }))
          }}
        >
          <SelectTrigger
            id="desktop-recording-bitrate"
            size="sm"
            className="w-full"
          >
            <SelectValue>{bitrateLabel(settings.bitrate)}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {DESKTOP_RECORDING_BITRATES.map((bitrate) => (
              <SelectItem key={bitrate} value={bitrate}>
                {bitrateLabel(bitrate)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor="desktop-recording-encoder" className="text-xs">
          {tx("Video encoder")}
        </FieldLabel>
        <Select
          value={settings.encoder}
          disabled={busy}
          onValueChange={(value) => {
            const encoder = asLiteral(value, DESKTOP_RECORDING_ENCODERS)
            if (encoder) {
              void save({
                ...settings,
                encoder,
                codec: encoder === "software" ? "h264" : settings.codec,
              })
            }
          }}
        >
          <SelectTrigger
            id="desktop-recording-encoder"
            size="sm"
            className="w-full"
          >
            <SelectValue>{ENCODER_LABELS[settings.encoder]}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {DESKTOP_RECORDING_ENCODERS.map((encoder) => (
              <SelectItem key={encoder} value={encoder}>
                {ENCODER_LABELS[encoder]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor="desktop-recording-codec" className="text-xs">
          {tx("Codec")}
        </FieldLabel>
        <Select
          value={settings.codec}
          disabled={busy || codecs.length === 0}
          onValueChange={(value) => {
            const codec = asLiteral(value, codecs)
            if (codec) void save({ ...settings, codec })
          }}
        >
          <SelectTrigger
            id="desktop-recording-codec"
            size="sm"
            className="w-full"
          >
            <SelectValue>
              {CODEC_LABELS[settings.codec]}
              {selectedCodecSupported ? "" : tx("(unsupported)")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {codecs.map((codec) => (
              <SelectItem key={codec} value={codec}>
                {CODEC_LABELS[codec]}
              </SelectItem>
            ))}
            {selectedCodecSupported ? null : (
              <SelectItem key={settings.codec} value={settings.codec} disabled>
                {CODEC_LABELS[settings.codec]} {tx("(unsupported)")}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor="desktop-recording-gpu" className="text-xs">
          {tx("GPU")}
        </FieldLabel>
        <Select
          value={settings.gpu}
          disabled={busy || settings.encoder === "software"}
          onValueChange={(gpu) => {
            if (gpu) void save({ ...settings, gpu })
          }}
        >
          <SelectTrigger
            id="desktop-recording-gpu"
            size="sm"
            className="w-full"
          >
            <SelectValue>{gpuLabel(settings.gpu)}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {gpus.map((gpu) => (
              <SelectItem key={gpu} value={gpu}>
                {gpuLabel(gpu)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}

function updateCustomQuality(
  settings: RecordingSettings,
  patch: Partial<RecordingSettings["customQuality"]>,
): RecordingSettings {
  const customQuality = {
    resolution: settings.resolution,
    fps: settings.fps,
    bitrate: settings.bitrate,
    ...patch,
  }
  return {
    ...settings,
    resolution: customQuality.resolution,
    fps: customQuality.fps,
    bitrate: customQuality.bitrate,
    qualityProfile: "custom",
    customQuality,
  }
}

function gpuOptions(available: string[], selected: string): string[] {
  const options = new Set(["auto", ...available])
  if (selected) options.add(selected)
  return [...options]
}

function codecOptions(available: RecordingCodec[]): readonly RecordingCodec[] {
  return [...new Set(available)]
}
