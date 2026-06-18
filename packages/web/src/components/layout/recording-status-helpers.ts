import type {
  RecordingDisplay,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"

export type SaveRecordingSettings = (next: RecordingSettings) => Promise<void>

export function mergeAudioDevices(
  available: RecordingSettings["audioDevices"],
  selected: RecordingSettings["audioDevices"],
): RecordingSettings["audioDevices"] {
  const byKey = new Map<string, RecordingSettings["audioDevices"][number]>()

  for (const device of available) byKey.set(audioDeviceKey(device), device)
  for (const device of selected) {
    const key = audioDeviceKey(device)
    byKey.set(key, {
      ...(byKey.get(key) ?? device),
      enabled: device.enabled,
      volume: device.volume,
    })
  }

  return [...byKey.values()]
}

export function toggleAudioDevice(
  current: RecordingSettings["audioDevices"],
  device: RecordingSettings["audioDevices"][number],
): RecordingSettings["audioDevices"] {
  const key = audioDeviceKey(device)
  const existing = current.find((item) => audioDeviceKey(item) === key)
  return [
    ...current.filter((item) => audioDeviceKey(item) !== key),
    {
      ...device,
      volume: existing?.volume ?? device.volume,
    },
  ]
}

export function audioDeviceMultiSelectLabel(
  selected: RecordingSettings["audioDevices"],
  settings: RecordingSettings | null,
): string {
  if (!settings) return tx("Loading")
  if (selected.length === 0) return tx("Off")
  if (selected.length === 1) return selected[0]?.label ?? "Off"
  return tx("{count} selected", { count: selected.length })
}

function audioDeviceKey(
  device: RecordingSettings["audioDevices"][number],
): string {
  return `${device.kind}:${device.id}`
}

export function selectedDisplay(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
  displays: RecordingDisplay[],
): RecordingDisplay | null {
  if (settings?.captureMode !== "display") return null

  return (
    displays.find((display) => display.id === settings.selectedDisplayId) ??
    displays.find((display) => display.id === status?.activeDisplay?.id) ??
    status?.activeDisplay ??
    null
  )
}

export function captureTargetLabel(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
): string {
  if (!settings) return tx("Loading capture")
  if (settings.captureMode === "display") {
    return status?.activeDisplay?.name ?? tx("Display capture")
  }
  return status?.activeGame
    ? tx("{game} is being captured", { game: status.activeGame })
    : tx("Alloy will start capturing when you launch a game.")
}

export function statusLabel(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
): string {
  if (!settings) return tx("Loading capture")
  if (settings.captureMode === "display") return tx("Display capture")
  if (!settings.enabled) return tx("Capture off")
  return status?.activeGame ?? tx("Waiting for game")
}

export function statusActive(status: RecordingStatus | null): boolean {
  return Boolean(status?.replayActive)
}

export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
