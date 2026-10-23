import {
  RECORDING_BITRATES,
  RECORDING_ENCODERS,
  RECORDING_FRAME_RATES,
  RECORDING_RESOLUTIONS,
  type RecordingCodec,
  type RecordingSettings,
  type RecordingStatus,
} from "@alloy/desktop-contracts"
import { t } from "@alloy/i18n"
import { Field, FieldLabel } from "@alloy/ui/components/field"

import { OptionSelect, type OptionSelectProps } from "./desktop-option-select"
import {
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
      <EncodingField
        id="desktop-recording-resolution"
        label={t("Resolution")}
        value={settings.resolution}
        options={RECORDING_RESOLUTIONS}
        optionLabel={(resolution) => RESOLUTION_LABELS[resolution]}
        disabled={busy}
        onValueChange={(resolution) =>
          void save(updateCustomQuality(settings, { resolution }))
        }
      />

      <EncodingField
        id="desktop-recording-fps"
        label={t("Frame rate")}
        value={settings.fps}
        options={RECORDING_FRAME_RATES}
        optionLabel={(fps) => `${fps} ${t("FPS")}`}
        disabled={busy}
        onValueChange={(fps) =>
          void save(updateCustomQuality(settings, { fps }))
        }
      />

      <EncodingField
        id="desktop-recording-bitrate"
        label={t("Bitrate")}
        value={settings.bitrate}
        options={RECORDING_BITRATES}
        optionLabel={bitrateLabel}
        disabled={busy}
        onValueChange={(bitrate) =>
          void save(updateCustomQuality(settings, { bitrate }))
        }
      />

      <EncodingField
        id="desktop-recording-encoder"
        label={t("Video encoder")}
        value={settings.encoder}
        options={RECORDING_ENCODERS}
        optionLabel={(encoder) => ENCODER_LABELS[encoder]}
        disabled={busy}
        onValueChange={(encoder) =>
          void save({
            ...settings,
            encoder,
            codec: encoder === "software" ? "h264" : settings.codec,
          })
        }
      />

      <EncodingField
        id="desktop-recording-codec"
        label={t("Codec")}
        value={settings.codec}
        // A saved codec this machine can't encode stays listed, disabled.
        options={selectedCodecSupported ? codecs : [...codecs, settings.codec]}
        optionLabel={(codec) =>
          codecs.includes(codec)
            ? CODEC_LABELS[codec]
            : `${CODEC_LABELS[codec]} ${t("(unsupported)")}`
        }
        optionDisabled={(codec) => !codecs.includes(codec)}
        disabled={busy || codecs.length === 0}
        onValueChange={(codec) => void save({ ...settings, codec })}
      />

      <EncodingField
        id="desktop-recording-gpu"
        label={t("GPU")}
        value={settings.gpu}
        options={gpus}
        optionLabel={gpuLabel}
        disabled={busy || settings.encoder === "software"}
        onValueChange={(gpu) => void save({ ...settings, gpu })}
      />
    </div>
  )
}

function EncodingField<T extends string | number>({
  label,
  ...select
}: Omit<OptionSelectProps<T>, "align" | "className"> & { label: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={select.id} className="text-xs">
        {label}
      </FieldLabel>
      <OptionSelect {...select} align="start" className="w-full" />
    </Field>
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
