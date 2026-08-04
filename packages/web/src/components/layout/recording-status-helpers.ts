import type {
  RecordingDisplay,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"

export type SaveRecordingSettings = (next: RecordingSettings) => Promise<void>
export type RecordingStatusIndicator = "active" | "draining" | "idle"

export function audioDeviceMultiSelectLabel(
  selected: RecordingSettings["audioDevices"],
  settings: RecordingSettings | null,
): string {
  if (!settings) return t("Loading")
  if (selected.length === 0) return t("Off")
  if (selected.length === 1) return selected[0]?.label ?? "Off"
  return t("{count} selected", { count: selected.length })
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
  if (status?.replayActive && !status.activeGame) {
    return t("Replay buffer winding down")
  }
  return status?.activeGame ?? t("Waiting for game")
}

export function statusIndicator(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
): RecordingStatusIndicator {
  if (!settings?.enabled || !status?.replayActive) return "idle"
  if (settings.captureMode === "game" && !status.activeGame) return "draining"
  return "active"
}

export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
