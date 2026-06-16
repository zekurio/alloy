import type {
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"

export interface SidecarConfig {
  settings: RecordingSettings
  outputFolder: string
  replayScratchFolder: string
  obsRuntimeDir: string | null
  discordDetectionCachePath: string | null
}

export type SidecarMethod =
  | "version"
  | "configure"
  | "status"
  | "listGameProcesses"
  | "listDisplays"
  | "saveReplayClip"
  | "addBookmark"
  | "toggleLongRecording"
  | "stopRecording"
  | "subscribeAudioLevels"
  | "stopAudioLevels"
  | "shutdown"

export interface SidecarRequest {
  id: number
  method: SidecarMethod
  params?: unknown
}

export interface SidecarResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
  status?: RecordingStatus
}

export interface SidecarEventEnvelope {
  event: RecordingEvent
}

export interface RecordingSidecarVersion {
  name: string
  version: string
  protocolVersion: number
  capabilities: string[]
}

export function isSidecarEventEnvelope(
  value: unknown,
): value is SidecarEventEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "event" in value &&
    typeof (value as { event?: unknown }).event === "object"
  )
}

export function isSidecarResponse(value: unknown): value is SidecarResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "number" &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  )
}
