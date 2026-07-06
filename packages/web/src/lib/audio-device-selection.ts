import type { RecordingAudioDeviceSelection } from "@alloy/contracts"

export function mergeAudioDevices(
  available: RecordingAudioDeviceSelection[],
  selected: RecordingAudioDeviceSelection[],
): RecordingAudioDeviceSelection[] {
  const byKey = new Map<string, RecordingAudioDeviceSelection>()

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
  current: RecordingAudioDeviceSelection[],
  device: RecordingAudioDeviceSelection,
): RecordingAudioDeviceSelection[] {
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

export function upsertAudioDevice(
  devices: RecordingAudioDeviceSelection[],
  device: RecordingAudioDeviceSelection,
): RecordingAudioDeviceSelection[] {
  return [
    ...devices.filter((item) => !sameAudioDeviceSelection(item, device)),
    device,
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
