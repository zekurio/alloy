import type {
  RecordingAudioApplicationSelection,
  RecordingAudioLevel,
} from "@alloy/desktop-contracts"
import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import { useEffect, useLayoutEffect, useRef, useState } from "react"

import type { RecordingAudioDeviceView } from "@/lib/audio-device-selection"
import { alloyDesktop } from "@/lib/desktop"

const AUDIO_LEVEL_HEARTBEAT_MS = 4000

/**
 * Live peak levels keyed by `audioLevelKey` while the audio settings are
 * mounted and visible. The desktop backend's subscription auto-expires, so
 * this re-sends it as a heartbeat (which also survives capture sidecar
 * restarts). Stays null
 * until the first sample arrives — e.g. outside the desktop app or while the
 * sidecar is missing — so the meters can stay hidden entirely.
 */
export function useAudioLevels(): ReadonlyMap<string, number> | null {
  const recording = alloyDesktop()?.recording ?? null
  const [levels, setLevels] = useState<Map<string, number> | null>(null)

  useEffect(() => {
    if (!recording) return

    const subscribe = () =>
      void recording.subscribeAudioLevels().catch(() => undefined)
    // Meters only matter while they are visible. A window hidden to the tray
    // stops the heartbeat instead of polling the recorder every few seconds.
    let heartbeat: ReturnType<typeof setInterval> | null = null
    const syncVisibility = () => {
      if (document.hidden) {
        if (heartbeat === null) return
        clearInterval(heartbeat)
        heartbeat = null
        void recording.stopAudioLevels().catch(() => undefined)
        return
      }
      if (heartbeat !== null) return
      subscribe()
      heartbeat = setInterval(subscribe, AUDIO_LEVEL_HEARTBEAT_MS)
    }
    syncVisibility()
    document.addEventListener("visibilitychange", syncVisibility)
    const unsubscribe = recording.onEvent((event) => {
      if (event.type !== "audio-levels") return
      setLevels(
        new Map(
          event.levels.map((level) => [audioLevelKey(level), level.peak]),
        ),
      )
    })

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility)
      if (heartbeat !== null) clearInterval(heartbeat)
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

export function deviceLevel(
  levels: ReadonlyMap<string, number> | null,
  device: RecordingAudioDeviceView,
): number | null {
  if (!levels || !device.available) return null
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

export function applicationLevel(
  levels: ReadonlyMap<string, number> | null,
  application: RecordingAudioApplicationSelection,
): number | null {
  if (!levels) return null
  return (
    levels.get(audioLevelKey({ target: "application", id: application.id })) ??
    0
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

export function AudioLevelMeter({
  peak,
  active,
}: {
  peak: number
  active: boolean
}) {
  const fraction = active ? peakMeterFraction(peak) : 0
  // Update the peak only after a render commits. Equal peaks extend the hold;
  // a lower sample replaces it after the hold time passes.
  const hold = useRef({ fraction: 0, at: 0 })
  const [held, setHeld] = useState(0)
  useLayoutEffect(() => {
    const now = Date.now()
    if (
      fraction >= hold.current.fraction ||
      now - hold.current.at > METER_PEAK_HOLD_MS ||
      !active
    ) {
      hold.current = { fraction, at: now }
      if (fraction !== held) setHeld(fraction)
    }
  })

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
      {held > 0 ? (
        <div
          className="bg-foreground/70 absolute inset-y-0 w-px"
          style={{ left: `${(held * 100).toFixed(2)}%` }}
        />
      ) : null}
    </div>
  )
}
