import type {
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"

export interface SidecarConfig {
  settings: RecordingSettings
  agentStateFolder: string
  outputFolder: string
  replayScratchFolder: string
  obsRuntimeDir: string | null
  discordDetectionCachePath: string | null
}

export const ALLOY_AGENT_PROTOCOL_VERSION = 1

/**
 * Every method the native agent answers. Kept as a value so the Rust and
 * TypeScript protocol surfaces can be compared mechanically.
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

export type SidecarEvent = RecordingEvent | { type: "clip-hotkey" }

export interface SidecarEventEnvelope {
  event: SidecarEvent
}

export interface RecordingSidecarVersion {
  name: string
  version: string
  protocolVersion: number
  capabilities: string[]
}

export function assertCurrentAgentVersion(
  version: RecordingSidecarVersion,
): void {
  if (
    version.name === "alloy-agent" &&
    version.protocolVersion === ALLOY_AGENT_PROTOCOL_VERSION
  ) {
    return
  }

  throw new Error(
    `Incompatible Alloy agent ${version.name} protocol ${version.protocolVersion}; expected alloy-agent protocol ${ALLOY_AGENT_PROTOCOL_VERSION}.`,
  )
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
