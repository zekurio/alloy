import {
  RECORDING_BUFFER_STORAGE,
  type RecordingSettings,
} from "@alloy/desktop-contracts"
import { t } from "@alloy/i18n"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Slider } from "@alloy/ui/components/slider"
import { CheckIcon } from "lucide-react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"

import { OptionSelect } from "./desktop-option-select"
import {
  applyQualitySettings,
  BUFFER_STORAGE_LABELS,
  CUSTOM_QUALITY_LABEL,
  estimateHourlyBytes,
  formatBytes,
  formatDuration,
  RECORDING_QUALITY_PRESET_OPTIONS,
  RESOLUTION_LABELS,
  selectedQualityPreset,
  type QualityPresetOption,
} from "./desktop-recording-helpers"
import { useSliderDraft } from "./use-slider-draft"

export function QualitySection({
  settings,
  busy,
  save,
}: {
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  const activePreset = selectedQualityPreset(settings)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {RECORDING_QUALITY_PRESET_OPTIONS.map((preset) => (
        <PresetCard
          key={preset.id}
          label={preset.label}
          spec={t("{resolution} · {fps} FPS", {
            fps: preset.fps,
            resolution: RESOLUTION_LABELS[preset.resolution],
          })}
          hourly={t("≈ {size}/hr", {
            size: formatBytes(
              estimateHourlyBytes(
                preset.resolution,
                preset.fps,
                preset.bitrate,
              ),
            ),
          })}
          active={activePreset?.id === preset.id}
          disabled={busy}
          onSelect={() => void save(applyPreset(settings, preset))}
        />
      ))}
      <PresetCard
        label={CUSTOM_QUALITY_LABEL}
        spec={t("{resolution} · {fps} FPS", {
          fps: settings.customQuality.fps,
          resolution: RESOLUTION_LABELS[settings.customQuality.resolution],
        })}
        hourly={t("≈ {size}/hr", {
          size: formatBytes(
            estimateHourlyBytes(
              settings.customQuality.resolution,
              settings.customQuality.fps,
              settings.customQuality.bitrate,
            ),
          ),
        })}
        active={settings.qualityProfile === "custom"}
        disabled={busy}
        onSelect={() => void save(applyCustomProfile(settings))}
      />
    </div>
  )
}

export function ReplayBufferSection({
  settings,
  busy,
  save,
}: {
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  const bufferSeconds = useSliderDraft(
    settings.replayBufferSeconds,
    (replayBufferSeconds) => void save({ ...settings, replayBufferSeconds }),
  )

  return (
    <SettingsSubsection id="replay-buffer" title={t("Replay buffer")}>
      <SettingRows>
        <SettingRow
          title={t("Replay buffer")}
          description={t("The rolling window the clip hotkey saves.")}
          htmlFor="desktop-recording-buffer"
        >
          <div className="flex w-44 items-center gap-3 sm:w-56">
            <Slider
              id="desktop-recording-buffer"
              min={15}
              max={600}
              step={15}
              {...bufferSeconds.sliderProps}
              disabled={busy}
              className="min-w-0 flex-1"
            />
            <div className="border-border bg-surface-raised min-w-14 rounded-md border px-2 py-1 text-center text-xs font-medium">
              {formatDuration(bufferSeconds.value)}
            </div>
          </div>
        </SettingRow>
        <SettingRow
          title={t("Buffer storage")}
          description={t("Where replay video is kept before a clip is saved.")}
          htmlFor="desktop-recording-buffer-storage"
        >
          <OptionSelect
            id="desktop-recording-buffer-storage"
            value={settings.bufferStorage}
            options={RECORDING_BUFFER_STORAGE}
            optionLabel={(storage) => BUFFER_STORAGE_LABELS[storage]}
            disabled={busy}
            onValueChange={(bufferStorage) =>
              void save({ ...settings, bufferStorage })
            }
            className="w-32"
            align="end"
          />
        </SettingRow>
      </SettingRows>
    </SettingsSubsection>
  )
}

function applyPreset(
  settings: RecordingSettings,
  preset: QualityPresetOption,
): RecordingSettings {
  return {
    ...applyQualitySettings(settings, preset),
    qualityProfile: preset.id,
  }
}

function applyCustomProfile(settings: RecordingSettings): RecordingSettings {
  return {
    ...applyQualitySettings(settings, settings.customQuality),
    qualityProfile: "custom",
  }
}

function PresetCard({
  label,
  spec,
  hourly,
  active,
  disabled,
  onSelect,
}: {
  label: string
  spec: string
  hourly: string
  active: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={[
        "relative flex flex-col gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-accent-border bg-accent/5"
          : "border-border hover:border-border-strong hover:bg-white/[0.03]",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      {active ? (
        <CheckIcon className="text-accent absolute top-2 right-2 size-3.5" />
      ) : null}
      <span className="pr-5 text-sm font-medium">{label}</span>
      <span className="text-foreground-dim text-xs">{spec}</span>
      <span className="text-foreground-faint text-xs">{hourly}</span>
    </button>
  )
}
