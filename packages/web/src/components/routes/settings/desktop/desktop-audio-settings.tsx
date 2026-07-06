import type {
  RecordingAudioApplicationSelection,
  RecordingAudioDeviceKind,
  RecordingAudioDeviceSelection,
  RecordingAudioLevel,
  RecordingSettings,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Checkbox } from "@alloy/ui/components/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Slider } from "@alloy/ui/components/slider"
import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"
import {
  AppWindowIcon,
  MicIcon,
  Volume2Icon,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { alloyDesktop, DESKTOP_RECORDING_AUDIO_MODES } from "./desktop-bridge"
import { useDesktopRecording } from "./desktop-recording-context"
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

const AUDIO_DEVICE_ICONS: Record<RecordingAudioDeviceKind, LucideIcon> = {
  output: Volume2Icon,
  input: MicIcon,
}

const AUDIO_LEVEL_HEARTBEAT_MS = 4000

/**
 * Live peak levels keyed by `audioLevelKey` while the audio settings are
 * mounted. The desktop backend's subscription auto-expires, so this re-sends
 * it as a heartbeat (which also survives capture sidecar restarts). Stays null
 * until the first sample arrives — e.g. outside the desktop app or while the
 * sidecar is missing — so the meters can stay hidden entirely.
 */
function useAudioLevels(): ReadonlyMap<string, number> | null {
  const recording = alloyDesktop()?.recording ?? null
  const [levels, setLevels] = useState<Map<string, number> | null>(null)

  useEffect(() => {
    if (!recording) return

    const subscribe = () =>
      void recording.subscribeAudioLevels().catch(() => undefined)
    subscribe()
    const heartbeat = setInterval(subscribe, AUDIO_LEVEL_HEARTBEAT_MS)
    const unsubscribe = recording.onEvent((event) => {
      if (event.type !== "audio-levels") return
      setLevels(
        new Map(
          event.levels.map((level) => [audioLevelKey(level), level.peak]),
        ),
      )
    })

    return () => {
      clearInterval(heartbeat)
      unsubscribe()
      void recording.stopAudioLevels().catch(() => undefined)
    }
  }, [recording])

  return levels
}

function audioLevelKey(
  level: Pick<RecordingAudioLevel, "target" | "kind" | "id">,
): string {
  return level.target === "device"
    ? `device:${level.kind ?? ""}:${level.id}`
    : `application:${level.id}`
}

function deviceLevel(
  levels: ReadonlyMap<string, number> | null,
  device: RecordingAudioDeviceSelection,
): number | null {
  if (!levels) return null
  return (
    levels.get(
      audioLevelKey({
        target: "device",
        kind: device.kind,
        id: device.id.toLowerCase(),
      }),
    ) ?? 0
  )
}

function applicationLevel(
  levels: ReadonlyMap<string, number> | null,
  application: RecordingAudioApplicationSelection,
): number | null {
  if (!levels) return null
  return (
    levels.get(audioLevelKey({ target: "application", id: application.id })) ??
    0
  )
}

export function DesktopAudioSettings() {
  const { settings, status, busy, save } = useDesktopRecording()
  const levels = useAudioLevels()

  if (!settings || !status) {
    return (
      <div className="text-foreground-muted flex h-20 items-center justify-center gap-2 text-sm">
        <Spinner />
        {t("Loading audio settings")}
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
        title={t("Capture audio from")}
        description={t(
          "Record individual playback and capture devices, or per-application audio streams.",
        )}
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
          levels={levels}
        />
      ) : (
        <>
          <AudioApplicationList
            applications={applications}
            settings={settings}
            busy={controlsDisabled}
            save={save}
            levels={levels}
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
          />
        </>
      )}
    </div>
  )
}

function AudioDeviceList({
  devices,
  settings,
  busy,
  save,
  levels,
  kinds,
}: {
  devices: RecordingAudioDeviceSelection[]
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
  levels: ReadonlyMap<string, number> | null
  /** Restricts the rendered device groups (e.g. input-only in apps mode). */
  kinds?: RecordingAudioDeviceKind[]
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
      <p className="text-foreground-dim py-2 text-xs">
        {t("No audio devices are available.")}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
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
                  level={deviceLevel(levels, device)}
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
  levels,
}: {
  applications: RecordingAudioApplicationSelection[]
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
  levels: ReadonlyMap<string, number> | null
}) {
  if (applications.length === 0) {
    return (
      <p className="text-foreground-dim py-2 text-xs">
        {t("Running applications outputting audio will appear here.")}
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
          level={applicationLevel(levels, application)}
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
  level,
  busy,
  onChange,
}: {
  id: string
  icon: ReactNode
  title: string
  subtitle?: string | null
  enabled: boolean
  volume: number
  /** Live linear peak 0..1 pre-volume, or null when metering is unavailable. */
  level: number | null
  busy: boolean
  onChange: (patch: { enabled?: boolean; volume?: number }) => void
}) {
  const [draftVolume, setDraftVolume] = useState<number | null>(null)
  const displayVolume = draftVolume ?? volume

  return (
    <div className="not-last:border-border flex flex-col py-2.5 not-last:border-b first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
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

/**
 * OBS mixer color zones over a -60..0 dBFS scale: green below -20 dB, yellow
 * to -9 dB, red above. Hard gradient stops sit at those boundaries and the
 * fill is revealed with a clip so the zones stay fixed in place.
 */
const METER_MIN_DB = -60
const METER_YELLOW_DB = -20
const METER_RED_DB = -9
const METER_GRADIENT = `linear-gradient(to right,
  #22c55e ${meterDbStop(METER_YELLOW_DB)},
  #eab308 ${meterDbStop(METER_YELLOW_DB)},
  #eab308 ${meterDbStop(METER_RED_DB)},
  #ef4444 ${meterDbStop(METER_RED_DB)})`
/** How long a transient's peak position stays marked on the meter. */
const METER_PEAK_HOLD_MS = 1500

function meterDbStop(db: number): string {
  return `${(meterFraction(db) * 100).toFixed(2)}%`
}

function meterFraction(db: number): number {
  return Math.min(Math.max(1 - db / METER_MIN_DB, 0), 1)
}

function peakMeterFraction(peak: number): number {
  if (peak <= 0) return 0
  return meterFraction(20 * Math.log10(peak))
}

function AudioLevelMeter({ peak, active }: { peak: number; active: boolean }) {
  const fraction = active ? peakMeterFraction(peak) : 0
  // Peak-hold marker: keeps the loudest recent position visible so transients
  // between samples still register. Ref mutation during render is safe here —
  // the computation is idempotent for a given sample.
  const hold = useRef({ fraction: 0, at: 0 })
  const now = Date.now()
  if (
    fraction >= hold.current.fraction ||
    now - hold.current.at > METER_PEAK_HOLD_MS ||
    !active
  ) {
    hold.current = { fraction, at: now }
  }

  return (
    <div
      className={cn(
        "bg-surface-raised relative h-1 min-w-0 flex-1 overflow-hidden rounded-full",
        !active && "opacity-40",
      )}
      role="meter"
      aria-label={t("Audio level")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <div
        className="absolute inset-0 opacity-25"
        style={{ backgroundImage: METER_GRADIENT }}
      />
      <div
        className="absolute inset-0 transition-[clip-path] duration-100 ease-linear"
        style={{
          backgroundImage: METER_GRADIENT,
          clipPath: `inset(0 ${((1 - fraction) * 100).toFixed(2)}% 0 0)`,
        }}
      />
      {hold.current.fraction > 0 ? (
        <div
          className="bg-foreground/70 absolute inset-y-0 w-px"
          style={{ left: `${(hold.current.fraction * 100).toFixed(2)}%` }}
        />
      ) : null}
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
    const availableDevice = availableAudioDeviceForSelection(available, device)
    byId.set(audioDeviceKey(availableDevice ?? device), {
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
  const next = devices.filter((item) => !sameAudioDeviceSelection(item, device))
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

function availableAudioDeviceForSelection(
  available: RecordingAudioDeviceSelection[],
  selected: RecordingAudioDeviceSelection,
): RecordingAudioDeviceSelection | undefined {
  return (
    available.find(
      (device) => audioDeviceKey(device) === audioDeviceKey(selected),
    ) ?? available.find((device) => sameAudioDeviceSelection(device, selected))
  )
}

function sameAudioDeviceSelection(
  left: RecordingAudioDeviceSelection,
  right: RecordingAudioDeviceSelection,
): boolean {
  return (
    audioDeviceKey(left) === audioDeviceKey(right) ||
    (left.kind === right.kind && left.label === right.label)
  )
}

function audioDeviceKey(device: RecordingAudioDeviceSelection): string {
  return `${device.kind}:${device.id}`
}

function sliderValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : (value[0] ?? 0)
}
