import {
  RECORDING_MAX_AUDIO_SOURCES,
  type RecordingAudioApplicationSelection,
  type RecordingAudioDeviceKind,
  type RecordingSettings,
} from "@alloy/desktop-contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Checkbox } from "@alloy/ui/components/checkbox"
import { LoadingState } from "@alloy/ui/components/loading-state"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Slider } from "@alloy/ui/components/slider"
import { toast } from "@alloy/ui/lib/toast"
import { cn, sliderValue } from "@alloy/ui/lib/utils"
import {
  AppWindowIcon,
  MicIcon,
  Volume2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import type { ReactNode } from "react"

import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import {
  enabledAudioSourceCount,
  mergeAudioDevices,
  type RecordingAudioDeviceView,
  upsertAudioDevice,
} from "@/lib/audio-device-selection"

import {
  applicationLevel,
  AudioLevelMeter,
  deviceLevel,
  useAudioLevels,
} from "./desktop-audio-levels"
import { DESKTOP_RECORDING_AUDIO_MODES } from "./desktop-native"
import {
  DesktopRecordingNotice,
  useDesktopRecording,
} from "./desktop-recording-context"
import {
  asLiteral,
  AUDIO_DEVICE_KIND_LABELS,
  AUDIO_MODE_LABELS,
} from "./desktop-recording-helpers"

const AUDIO_DEVICE_GROUPS: Array<{
  kind: RecordingAudioDeviceKind
  title: string
}> = [
  { kind: "output", title: t("Output") },
  { kind: "input", title: t("Input") },
]

const AUDIO_DEVICE_ICONS = {
  output: Volume2Icon,
  input: MicIcon,
} satisfies Record<RecordingAudioDeviceKind, LucideIcon>

export function DesktopAudioSettings() {
  const { settings, status, busy, error, save } = useDesktopRecording()
  const levels = useAudioLevels()
  const devices = useMemo(
    () =>
      mergeAudioDevices(
        status?.availableAudioDevices ?? [],
        settings?.audioDevices ?? [],
      ),
    [settings?.audioDevices, status?.availableAudioDevices],
  )

  if (!settings || !status) {
    if (error) return <DesktopRecordingNotice />
    return <LoadingState variant="panel" />
  }

  const applications = mergeAudioApplications(
    status.availableAudioApplications,
    settings.audioApplications,
  )
  const controlsDisabled = busy
  const sourceLimitReached =
    enabledAudioSourceCount(settings) >= RECORDING_MAX_AUDIO_SOURCES

  return (
    <SettingsSections>
      <DesktopRecordingNotice />
      <SettingsSubsection id="audio-source" title={t("Audio source")}>
        <SettingRows>
          <SettingRow
            title={t("Capture audio from")}
            description={t(
              "Mix selected playback devices and microphones, or application audio streams.",
            )}
            htmlFor="desktop-recording-audio-mode"
          >
            <Select
              value={settings.audioMode}
              disabled={controlsDisabled}
              onValueChange={(value) => {
                const audioMode = asLiteral(
                  value,
                  DESKTOP_RECORDING_AUDIO_MODES,
                )
                if (audioMode) void save({ ...settings, audioMode })
              }}
            >
              <SelectTrigger
                id="desktop-recording-audio-mode"
                size="sm"
                className="w-40"
              >
                <SelectValue>
                  {AUDIO_MODE_LABELS[settings.audioMode]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {DESKTOP_RECORDING_AUDIO_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {AUDIO_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingRows>
      </SettingsSubsection>

      {settings.audioMode === "devices" ? (
        <AudioDeviceList
          devices={devices}
          settings={settings}
          busy={controlsDisabled}
          save={save}
          levels={levels}
          sourceLimitReached={sourceLimitReached}
        />
      ) : (
        <>
          <AudioApplicationList
            applications={applications}
            settings={settings}
            busy={controlsDisabled}
            save={save}
            levels={levels}
            sourceLimitReached={sourceLimitReached}
          />
          {/* Microphones aren't application streams, so input devices stay
              manageable here for voice-over alongside the app audio. */}
          <AudioDeviceList
            devices={devices}
            settings={settings}
            busy={controlsDisabled}
            save={save}
            levels={levels}
            kinds={["input"]}
            sourceLimitReached={sourceLimitReached}
          />
        </>
      )}
    </SettingsSections>
  )
}

function AudioDeviceList({
  devices,
  settings,
  busy,
  save,
  levels,
  kinds,
  sourceLimitReached,
}: {
  devices: RecordingAudioDeviceView[]
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
  levels: ReadonlyMap<string, number> | null
  /** Restricts the rendered device groups (e.g. input-only in apps mode). */
  kinds?: RecordingAudioDeviceKind[]
  /** Whether enabling another source would exceed the recorder's channel limit. */
  sourceLimitReached: boolean
}) {
  const groups = kinds
    ? AUDIO_DEVICE_GROUPS.filter((group) => kinds.includes(group.kind))
    : AUDIO_DEVICE_GROUPS
  const hasDevices = devices.some(
    (device) => !kinds || kinds.includes(device.kind),
  )

  if (!hasDevices) {
    // In apps mode the input section is supplementary; stay quiet when there
    // are no microphones rather than showing a full empty state.
    if (kinds) return null
    return (
      <p className="text-foreground-dim text-xs">
        {t("No audio devices are available.")}
      </p>
    )
  }

  return (
    <>
      {groups.map((group) => {
        const groupDevices = devices.filter(
          (device) => device.kind === group.kind,
        )
        if (groupDevices.length === 0) return null

        const Icon = AUDIO_DEVICE_ICONS[group.kind]
        return (
          <SettingsSubsection
            key={group.kind}
            id={`devices-${group.kind}`}
            title={
              <span className="flex items-center gap-2">
                <Icon className="text-foreground-muted size-4" />
                {group.title}
              </span>
            }
            navLabel={group.title}
          >
            <SettingRows>
              {groupDevices.map((device) => (
                <AudioRow
                  key={`${device.kind}:${device.id}`}
                  id={`desktop-recording-audio-device-${device.kind}-${device.id}`}
                  icon={<Icon className="size-4" />}
                  title={device.label}
                  subtitle={
                    device.available
                      ? AUDIO_DEVICE_KIND_LABELS[device.kind]
                      : t("Unavailable")
                  }
                  enabled={device.enabled}
                  volume={device.volume}
                  available={device.available}
                  level={deviceLevel(levels, device)}
                  busy={busy}
                  sourceLimitReached={sourceLimitReached}
                  onRemove={
                    device.available
                      ? undefined
                      : () =>
                          void save({
                            ...settings,
                            audioDevices: settings.audioDevices.filter(
                              (selection) =>
                                selection.kind !== device.kind ||
                                selection.id !== device.id,
                            ),
                          })
                  }
                  onChange={(patch) =>
                    void save({
                      ...settings,
                      audioDevices: upsertAudioDevice(settings.audioDevices, {
                        id: device.id,
                        label: device.label,
                        kind: device.kind,
                        enabled: patch.enabled ?? device.enabled,
                        volume: patch.volume ?? device.volume,
                      }),
                    })
                  }
                />
              ))}
            </SettingRows>
          </SettingsSubsection>
        )
      })}
    </>
  )
}

function AudioApplicationList({
  applications,
  settings,
  busy,
  save,
  levels,
  sourceLimitReached,
}: {
  applications: RecordingAudioApplicationSelection[]
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
  levels: ReadonlyMap<string, number> | null
  /** Whether enabling another source would exceed the recorder's channel limit. */
  sourceLimitReached: boolean
}) {
  if (applications.length === 0) {
    return (
      <SettingsSubsection id="applications" title={t("Applications")}>
        <p className="text-foreground-dim text-xs">
          {t("Running applications outputting audio will appear here.")}
        </p>
      </SettingsSubsection>
    )
  }

  return (
    <SettingsSubsection id="applications" title={t("Applications")}>
      <SettingRows>
        {applications.map((application) => (
          <AudioRow
            key={application.id}
            id={`desktop-recording-audio-application-${application.id}`}
            icon={<ApplicationAudioIcon application={application} />}
            title={application.name}
            subtitle={application.executable ?? application.window}
            enabled={application.enabled}
            volume={application.volume}
            available
            level={applicationLevel(levels, application)}
            busy={busy}
            sourceLimitReached={sourceLimitReached}
            onChange={(patch) =>
              void save({
                ...settings,
                audioApplications: upsertAudioApplication(
                  settings.audioApplications,
                  {
                    ...application,
                    ...patch,
                  },
                ),
              })
            }
          />
        ))}
      </SettingRows>
    </SettingsSubsection>
  )
}

function ApplicationAudioIcon({
  application,
}: {
  application: RecordingAudioApplicationSelection
}) {
  if (application.iconUrl) {
    return (
      <img
        src={application.iconUrl}
        alt=""
        draggable={false}
        className="size-4 object-contain"
      />
    )
  }

  return <AppWindowIcon className="size-4" />
}

/**
 * One audio source row: enable checkbox, kind icon, label, and a live volume
 * slider with a percentage readout. The slider tracks a local draft while
 * dragging and only persists on commit to avoid a save per pointer move.
 * While live levels are available (`level` is non-null) an OBS-style meter
 * renders below the row.
 */
function AudioRow({
  id,
  icon,
  title,
  subtitle,
  enabled,
  volume,
  available,
  level,
  busy,
  sourceLimitReached,
  onRemove,
  onChange,
}: {
  id: string
  icon: ReactNode
  title: string
  subtitle?: string | null
  enabled: boolean
  volume: number
  available: boolean
  /** Live linear peak 0..1 pre-volume, or null when metering is unavailable. */
  level: number | null
  busy: boolean
  /** Whether enabling another source would exceed the recorder's channel limit. */
  sourceLimitReached: boolean
  onRemove?: () => void
  onChange: (patch: { enabled?: boolean; volume?: number }) => void
}) {
  const [draftVolume, setDraftVolume] = useState<number | null>(null)
  const displayVolume = draftVolume ?? volume

  return (
    <div className="not-last:border-border flex flex-col py-3 not-last:border-b first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <Checkbox
          id={id}
          checked={enabled}
          disabled={busy || (!available && !enabled)}
          onCheckedChange={(checked) => {
            if (checked === true && sourceLimitReached) {
              toast.error(
                t("You can capture up to {count} audio sources at once.", {
                  count: RECORDING_MAX_AUDIO_SOURCES,
                }),
              )
              return
            }
            onChange({ enabled: checked === true })
          }}
        />
        <span
          className={cn(
            "bg-surface-raised text-foreground-muted flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md transition-opacity",
            (!enabled || !available) && "opacity-50",
          )}
        >
          {icon}
        </span>
        <label
          htmlFor={id}
          className={cn(
            "min-w-0 flex-1 cursor-pointer transition-opacity",
            (!enabled || !available) && "opacity-50",
          )}
        >
          <span className="block truncate text-sm font-medium">{title}</span>
          {subtitle ? (
            <span className="text-foreground-dim block truncate text-xs">
              {subtitle}
            </span>
          ) : null}
        </label>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={t("Remove unavailable device")}
            title={t("Remove unavailable device")}
            onClick={onRemove}
          >
            <XIcon className="size-4" />
          </Button>
        ) : null}
        <div className="flex w-36 items-center gap-3 sm:w-52">
          <Slider
            min={0}
            max={100}
            step={1}
            value={[displayVolume]}
            disabled={busy || !enabled || !available}
            onValueChange={(value) => setDraftVolume(sliderValue(value))}
            onValueCommitted={(value) => {
              setDraftVolume(null)
              onChange({ volume: sliderValue(value) })
            }}
            className="min-w-0 flex-1"
          />
          <span
            className={cn(
              "w-9 shrink-0 text-right text-xs tabular-nums transition-opacity",
              enabled ? "text-foreground-muted" : "text-foreground-faint",
            )}
          >
            {displayVolume}
            {"%"}
          </span>
        </div>
      </div>
      {level !== null ? (
        <div className="mt-2 flex items-center gap-3">
          {/* Spacers mirror the checkbox + icon columns above. */}
          <span className="w-4 shrink-0" />
          <span className="w-7 shrink-0" />
          <AudioLevelMeter
            peak={level * (displayVolume / 100)}
            active={enabled}
          />
        </div>
      ) : null}
    </div>
  )
}

function mergeAudioApplications(
  available: RecordingAudioApplicationSelection[],
  selected: RecordingAudioApplicationSelection[],
): RecordingAudioApplicationSelection[] {
  const byId = new Map<string, RecordingAudioApplicationSelection>()

  for (const application of available) {
    byId.set(application.id, application)
  }
  for (const application of selected) {
    const availableApplication = byId.get(application.id)
    byId.set(application.id, {
      ...(availableApplication ?? application),
      enabled: application.enabled,
      volume: application.volume,
    })
  }

  return [...byId.values()]
}

function upsertAudioApplication(
  applications: RecordingAudioApplicationSelection[],
  application: RecordingAudioApplicationSelection,
): RecordingAudioApplicationSelection[] {
  return [
    ...applications.filter((item) => item.id !== application.id),
    application,
  ]
}
