import type { RecordingSettings } from "alloy-contracts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "alloy-ui/components/select"
import { Slider } from "alloy-ui/components/slider"
import { CheckIcon } from "lucide-react"
import { type Dispatch, type SetStateAction } from "react"

import { DESKTOP_RECORDING_BUFFER_STORAGE } from "./desktop-bridge"
import { Subsection } from "./desktop-capture-sections"
import {
  asLiteral,
  applyQualitySettings,
  BUFFER_STORAGE_LABELS,
  CUSTOM_QUALITY_LABEL,
  estimateHourlyBytes,
  formatBytes,
  formatDuration,
  RECORDING_QUALITY_PRESETS,
  RESOLUTION_LABELS,
  selectedQualityPreset,
  type QualityPresetOption,
} from "./desktop-recording-helpers"
import { SettingRow } from "./setting-row"

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
    <Subsection title="Quality">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RECORDING_QUALITY_PRESETS.map((preset) => (
          <PresetCard
            key={preset.id}
            label={preset.label}
            spec={`${RESOLUTION_LABELS[preset.resolution]} · ${preset.fps} FPS`}
            hourly={`≈ ${formatBytes(
              estimateHourlyBytes(
                preset.resolution,
                preset.fps,
                preset.bitrate,
              ),
            )}/hr`}
            active={activePreset?.id === preset.id}
            disabled={busy}
            onSelect={() => void save(applyPreset(settings, preset))}
          />
        ))}
        <PresetCard
          label={CUSTOM_QUALITY_LABEL}
          spec={`${RESOLUTION_LABELS[settings.customQuality.resolution]} · ${
            settings.customQuality.fps
          } FPS`}
          hourly={`≈ ${formatBytes(
            estimateHourlyBytes(
              settings.customQuality.resolution,
              settings.customQuality.fps,
              settings.customQuality.bitrate,
            ),
          )}/hr`}
          active={settings.qualityProfile === "custom"}
          disabled={busy}
          onSelect={() => void save(applyCustomProfile(settings))}
        />
      </div>
    </Subsection>
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
    <Subsection title="Replay buffer">
      <SettingRow
        title="Clip length"
        description="How much video the replay buffer keeps before you press clip."
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
        title="Buffer storage"
        description="Where replay video is kept before a clip is saved."
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
    </Subsection>
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
      <span className="pr-5 text-sm font-semibold">{label}</span>
      <span className="text-foreground-dim text-xs">{spec}</span>
      <span className="text-foreground-faint text-xs">{hourly}</span>
    </button>
  )
}
