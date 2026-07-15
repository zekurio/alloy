import type { RecordingSettings } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Slider } from "@alloy/ui/components/slider"
import { CheckIcon } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"

import { DESKTOP_RECORDING_BUFFER_STORAGE } from "./desktop-bridge"
import {
  asLiteral,
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
  setSettings,
  save,
}: {
  settings: RecordingSettings
  busy: boolean
  setSettings: Dispatch<SetStateAction<RecordingSettings | null>>
  save: (next: RecordingSettings) => Promise<void>
}) {
  return (
    <SettingsSubsection title={t("Replay buffer")}>
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
            value={[settings.replayBufferSeconds]}
            disabled={busy}
            onValueChange={(value) =>
              setSettings({
                ...settings,
                replayBufferSeconds: sliderValue(value),
              })
            }
            onValueCommitted={(value) =>
              void save({
                ...settings,
                replayBufferSeconds: sliderValue(value),
              })
            }
            className="min-w-0 flex-1"
          />
          <div className="border-border bg-surface-raised min-w-14 rounded-md border px-2 py-1 text-center text-xs font-medium">
            {formatDuration(settings.replayBufferSeconds)}
          </div>
        </div>
      </SettingRow>
      <SettingRow
        title={t("Buffer storage")}
        description={t("Where replay video is kept before a clip is saved.")}
        htmlFor="desktop-recording-buffer-storage"
      >
        <Select
          value={settings.bufferStorage}
          disabled={busy}
          onValueChange={(value) => {
            const bufferStorage = asLiteral(
              value,
              DESKTOP_RECORDING_BUFFER_STORAGE,
            )
            if (bufferStorage) void save({ ...settings, bufferStorage })
          }}
        >
          <SelectTrigger
            id="desktop-recording-buffer-storage"
            size="sm"
            className="w-32"
          >
            <SelectValue>
              {BUFFER_STORAGE_LABELS[settings.bufferStorage]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {DESKTOP_RECORDING_BUFFER_STORAGE.map((storage) => (
              <SelectItem key={storage} value={storage}>
                {BUFFER_STORAGE_LABELS[storage]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
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

function sliderValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : (value[0] ?? 0)
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
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || !onSelect}
      className={[
        "relative flex flex-col gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-accent-border bg-accent/5"
          : "border-border hover:border-border-strong hover:bg-white/[0.03]",
        !onSelect
          ? "cursor-default hover:border-border hover:bg-transparent"
          : "",
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
