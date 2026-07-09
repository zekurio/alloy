import type {
  RecordingAudioDevice,
  RecordingAudioDeviceSelection,
} from "@alloy/contracts"

export interface RecordingAudioDeviceView extends RecordingAudioDeviceSelection {
  available: boolean
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
