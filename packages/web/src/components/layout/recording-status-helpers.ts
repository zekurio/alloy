import type {
  RecordingDisplay,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"

export type SaveRecordingSettings = (next: RecordingSettings) => Promise<void>

export function mergeAudioDevices(
  available: RecordingSettings["audioDevices"],
  selected: RecordingSettings["audioDevices"],
): RecordingSettings["audioDevices"] {
  const byKey = new Map<string, RecordingSettings["audioDevices"][number]>()

  for (const device of available) byKey.set(audioDeviceKey(device), device)
  for (const device of selected) {
    const availableDevice = availableAudioDeviceForSelection(available, device)
    byKey.set(audioDeviceKey(availableDevice ?? device), {
      ...(availableDevice ?? device),
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
  const existing = current.find((item) =>
    sameAudioDeviceSelection(item, device),
  )
  return [
    ...current.filter((item) => !sameAudioDeviceSelection(item, device)),
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
  if (!settings) return t("Loading")
  if (selected.length === 0) return t("Off")
  if (selected.length === 1) return selected[0]?.label ?? "Off"
  return t("{count} selected", { count: selected.length })
}

function availableAudioDeviceForSelection(
  available: RecordingSettings["audioDevices"],
  selected: RecordingSettings["audioDevices"][number],
): RecordingSettings["audioDevices"][number] | undefined {
  return (
    available.find(
      (device) => audioDeviceKey(device) === audioDeviceKey(selected),
    ) ?? available.find((device) => sameAudioDeviceSelection(device, selected))
  )
}

function sameAudioDeviceSelection(
  left: RecordingSettings["audioDevices"][number],
  right: RecordingSettings["audioDevices"][number],
): boolean {
  return (
    audioDeviceKey(left) === audioDeviceKey(right) ||
    (left.kind === right.kind && left.label === right.label)
  )
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
  if (!settings) return t("Loading capture")
  if (settings.captureMode === "display") {
    return status?.activeDisplay?.name ?? t("Display capture")
  }
  if (status?.activeGame) {
    return t("{game} is being captured", { game: status.activeGame })
  }
  return t("Alloy will start capturing when you launch a game.")
}

export function statusLabel(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
): string {
  if (!settings) return t("Loading capture")
  if (settings.captureMode === "display") return t("Display capture")
  if (!settings.enabled) return t("Capture off")
  return status?.activeGame ?? t("Waiting for game")
}

export function statusActive(status: RecordingStatus | null): boolean {
  return Boolean(status?.replayActive)
}

export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
