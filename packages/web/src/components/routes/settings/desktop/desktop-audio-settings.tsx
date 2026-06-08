import type {
  RecordingAudioApplicationSelection,
  RecordingAudioDeviceKind,
  RecordingAudioDeviceSelection,
  RecordingSettings,
} from "alloy-contracts"
import { Checkbox } from "alloy-ui/components/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "alloy-ui/components/select"
import { Slider } from "alloy-ui/components/slider"
import { Spinner } from "alloy-ui/components/spinner"
import { cn } from "alloy-ui/lib/utils"
import {
  AppWindowIcon,
  MicIcon,
  Volume2Icon,
  type LucideIcon,
} from "lucide-react"
import { useState, type ReactNode } from "react"

import { DESKTOP_RECORDING_AUDIO_MODES } from "./desktop-bridge"
import { useDesktopRecording } from "./desktop-recording-context"
import {
  asLiteral,
  AUDIO_DEVICE_KIND_LABELS,
  AUDIO_MODE_LABELS,
} from "./desktop-recording-helpers"
import { SettingRow } from "./setting-row"

const AUDIO_DEVICE_GROUPS: Array<{
  kind: RecordingAudioDeviceKind
  title: string
}> = [
  { kind: "output", title: "Output" },
  { kind: "input", title: "Input" },
]

const AUDIO_DEVICE_ICONS: Record<RecordingAudioDeviceKind, LucideIcon> = {
  output: Volume2Icon,
  input: MicIcon,
}

export function DesktopAudioSettings() {
  const { settings, status, busy, save } = useDesktopRecording()

  if (!settings || !status) {
    return (
      <div className="text-foreground-muted flex h-20 items-center justify-center gap-2 text-sm">
        <Spinner />
        Loading audio settings
      </div>
    )
  }

  const devices = mergeAudioDevices(
    status.availableAudioDevices,
    settings.audioDevices,
  )
  const applications = mergeAudioApplications(
    status.availableAudioApplications,
    settings.audioApplications,
  )
  const controlsDisabled = busy

  return (
    <div className="flex flex-col gap-6">
      <SettingRow
        title="Capture audio from"
        description="Record individual playback and capture devices, or per-application audio streams."
        htmlFor="desktop-recording-audio-mode"
      >
        <Select
          value={settings.audioMode}
          disabled={controlsDisabled}
          onValueChange={(value) => {
            const audioMode = asLiteral(value, DESKTOP_RECORDING_AUDIO_MODES)
            if (audioMode) void save({ ...settings, audioMode })
          }}
        >
          <SelectTrigger
            id="desktop-recording-audio-mode"
            size="sm"
            className="w-40"
          >
            <SelectValue>{AUDIO_MODE_LABELS[settings.audioMode]}</SelectValue>
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

      {settings.audioMode === "devices" ? (
        <AudioDeviceList
          devices={devices}
          settings={settings}
          busy={controlsDisabled}
          save={save}
        />
      ) : (
        <AudioApplicationList
          applications={applications}
          settings={settings}
          busy={controlsDisabled}
          save={save}
        />
      )}
    </div>
  )
}

function AudioDeviceList({
  devices,
  settings,
  busy,
  save,
}: {
  devices: RecordingAudioDeviceSelection[]
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  if (devices.length === 0) {
    return (
      <p className="text-foreground-dim py-2 text-xs">
        No audio devices are available.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {AUDIO_DEVICE_GROUPS.map((group) => {
        const groupDevices = devices.filter(
          (device) => device.kind === group.kind,
        )
        if (groupDevices.length === 0) return null

        const Icon = AUDIO_DEVICE_ICONS[group.kind]
        return (
          <section key={group.kind} className="flex flex-col gap-2">
            <h3 className="border-border text-foreground flex items-center gap-2 border-b pb-2 text-sm font-semibold">
              <Icon className="text-foreground-muted size-4" />
              {group.title}
            </h3>
            <div className="flex flex-col">
              {groupDevices.map((device) => (
                <AudioRow
                  key={`${device.kind}:${device.id}`}
                  id={`desktop-recording-audio-device-${device.kind}-${device.id}`}
                  icon={<Icon className="size-4" />}
                  title={device.label}
                  subtitle={AUDIO_DEVICE_KIND_LABELS[device.kind]}
                  enabled={device.enabled}
                  volume={device.volume}
                  busy={busy}
                  onChange={(patch) =>
                    void save({
                      ...settings,
                      audioDevices: upsertAudioDevice(settings.audioDevices, {
                        ...device,
                        ...patch,
                      }),
                    })
                  }
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function AudioApplicationList({
  applications,
  settings,
  busy,
  save,
}: {
  applications: RecordingAudioApplicationSelection[]
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  if (applications.length === 0) {
    return (
      <p className="text-foreground-dim py-2 text-xs">
        Running applications outputting audio will appear here.
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {applications.map((application) => (
        <AudioRow
          key={application.id}
          id={`desktop-recording-audio-application-${application.id}`}
          icon={<ApplicationAudioIcon application={application} />}
          title={application.name}
          subtitle={application.executable ?? application.window}
          enabled={application.enabled}
          volume={application.volume}
          busy={busy}
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
    </div>
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
 */
function AudioRow({
  id,
  icon,
  title,
  subtitle,
  enabled,
  volume,
  busy,
  onChange,
}: {
  id: string
  icon: ReactNode
  title: string
  subtitle?: string | null
  enabled: boolean
  volume: number
  busy: boolean
  onChange: (patch: { enabled?: boolean; volume?: number }) => void
}) {
  const [draftVolume, setDraftVolume] = useState<number | null>(null)
  const displayVolume = draftVolume ?? volume

  return (
    <div className="not-last:border-border flex items-center gap-3 py-2.5 not-last:border-b first:pt-0 last:pb-0">
      <Checkbox
        id={id}
        checked={enabled}
        disabled={busy}
        onCheckedChange={(checked) => onChange({ enabled: checked === true })}
      />
      <span
        className={cn(
          "bg-surface-raised text-foreground-muted flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md transition-opacity",
          !enabled && "opacity-50",
        )}
      >
        {icon}
      </span>
      <label
        htmlFor={id}
        className={cn(
          "min-w-0 flex-1 cursor-pointer transition-opacity",
          !enabled && "opacity-50",
        )}
      >
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="text-foreground-dim block truncate text-xs">
            {subtitle}
          </span>
        ) : null}
      </label>
      <div className="flex w-36 items-center gap-3 sm:w-52">
        <Slider
          min={0}
          max={100}
          step={1}
          value={[displayVolume]}
          disabled={busy || !enabled}
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
          {displayVolume}%
        </span>
      </div>
    </div>
  )
}

function mergeAudioDevices(
  available: RecordingAudioDeviceSelection[],
  selected: RecordingAudioDeviceSelection[],
): RecordingAudioDeviceSelection[] {
  const byId = new Map<string, RecordingAudioDeviceSelection>()

  for (const device of available) {
    byId.set(audioDeviceKey(device), device)
  }
  for (const device of selected) {
    const key = audioDeviceKey(device)
    const availableDevice = byId.get(key)
    byId.set(key, {
      ...(availableDevice ?? device),
      enabled: device.enabled,
      volume: device.volume,
    })
  }

  return [...byId.values()]
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

function upsertAudioDevice(
  devices: RecordingAudioDeviceSelection[],
  device: RecordingAudioDeviceSelection,
): RecordingAudioDeviceSelection[] {
  const key = audioDeviceKey(device)
  const next = devices.filter((item) => audioDeviceKey(item) !== key)
  return [...next, device]
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

function audioDeviceKey(device: RecordingAudioDeviceSelection): string {
  return `${device.kind}:${device.id}`
}

function sliderValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : (value[0] ?? 0)
}
