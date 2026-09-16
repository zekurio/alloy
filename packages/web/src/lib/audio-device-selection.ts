import type {
  RecordingAudioDevice,
  RecordingAudioDeviceSelection,
  RecordingSettings,
} from "@alloy/contracts"

export interface RecordingAudioDeviceView extends RecordingAudioDeviceSelection {
  available: boolean
}

/**
 * Audio sources the recorder captures for these settings: enabled devices, or
 * in applications mode the enabled input devices plus enabled applications
 * with a window. Matches the recorder's audio graph builder, where disabled
 * and windowless applications create no source.
 */
export function enabledAudioSourceCount(
  settings: Pick<
    RecordingSettings,
    "audioMode" | "audioDevices" | "audioApplications"
  >,
): number {
  const enabledDevices = settings.audioDevices.filter(
    (device) => device.enabled,
  )
  if (settings.audioMode !== "applications") return enabledDevices.length

  return (
    enabledDevices.filter((device) => device.kind === "input").length +
    settings.audioApplications.filter(
      (application) => application.enabled && application.window !== "",
    ).length
  )
}

export function mergeAudioDevices(
  available: RecordingAudioDevice[],
  selected: RecordingAudioDeviceSelection[],
): RecordingAudioDeviceView[] {
  const selectedByKey = new Map(
    selected.map((device) => [audioDeviceKey(device), device]),
  )
  const byKey = new Map<string, RecordingAudioDeviceView>()

  for (const device of available) {
    const selection = selectedByKey.get(audioDeviceKey(device))
    byKey.set(audioDeviceKey(device), {
      ...device,
      enabled: selection?.enabled ?? false,
      volume: selection?.volume ?? 100,
      available: true,
    })
  }
  for (const device of selected) {
    if (byKey.has(audioDeviceKey(device))) continue
    byKey.set(audioDeviceKey(device), { ...device, available: false })
  }

  return [...byKey.values()].sort(compareAudioDevices)
}

export function toggleAudioDevice(
  current: RecordingAudioDeviceSelection[],
  device: RecordingAudioDeviceSelection,
): RecordingAudioDeviceSelection[] {
  const index = current.findIndex(
    (item) => audioDeviceKey(item) === audioDeviceKey(device),
  )
  if (index < 0) return [...current, device]

  return current.map((item, itemIndex) =>
    itemIndex === index ? { ...device, volume: item.volume } : item,
  )
}

export function upsertAudioDevice(
  devices: RecordingAudioDeviceSelection[],
  device: RecordingAudioDeviceSelection,
): RecordingAudioDeviceSelection[] {
  const index = devices.findIndex(
    (item) => audioDeviceKey(item) === audioDeviceKey(device),
  )
  if (index < 0) return [...devices, device]

  return devices.map((item, itemIndex) => (itemIndex === index ? device : item))
}

function compareAudioDevices(
  left: RecordingAudioDevice,
  right: RecordingAudioDevice,
): number {
  return (
    Number(left.kind === "input") - Number(right.kind === "input") ||
    Number(right.id === "default") - Number(left.id === "default") ||
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
    left.id.localeCompare(right.id)
  )
}

function audioDeviceKey(device: RecordingAudioDevice): string {
  return `${device.kind}:${device.id}`
}
