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

/**
 * Every method the sidecar answers. Kept as a value, not a bare union, so
 * `recording-sidecar-protocol.test.ts` can check it against the match arms in
 * `packages/recorder/src/sidecar_runtime.rs` - the recorder only compiles on
 * Windows, so that seam has no other cross-language guard.
 */
export const SIDECAR_METHODS = [
  "version",
  "configure",
  "status",
  "listGameProcesses",
  "listDisplays",
  "saveReplayClip",
  "playNotificationSound",
  "subscribeAudioLevels",
  "stopAudioLevels",
  "shutdown",
] as const

export type SidecarMethod = (typeof SIDECAR_METHODS)[number]

export interface SidecarRequest {
  id: number
  method: SidecarMethod
  params?: unknown
  deadlineUnixMs: number
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
