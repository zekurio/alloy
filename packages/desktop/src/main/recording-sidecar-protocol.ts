import type {
  RecordingActionResult,
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  SaveReplayClipRequest,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"

import {
  parseBoolean,
  parseFiniteNumber,
  parseUntrustedRecord,
  type UntrustedInput,
} from "./runtime-validation"

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
  params?: SidecarParams
  deadlineUnixMs: number
}

export type SidecarParams =
  | SidecarConfig
  | SaveReplayClipRequest
  | { path: string; volume: number }

export interface SidecarResultByMethod {
  version: RecordingSidecarVersion
  configure: RecordingStatus
  status: RecordingStatus
  listGameProcesses: RecordingGameProcess[]
  listDisplays: RecordingDisplay[]
  saveReplayClip: RecordingActionResult
  playNotificationSound: null
  subscribeAudioLevels: null
  stopAudioLevels: null
  shutdown: RecordingStatus
}

export type SidecarResult = SidecarResultByMethod[SidecarMethod]

export interface SidecarResponse {
  id: number
  ok: boolean
  result?: SidecarResult
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
  value: UntrustedInput,
): value is SidecarEventEnvelope {
  const record = parseUntrustedRecord(value)
  return record !== null && parseUntrustedRecord(record.event) !== null
}

export function isSidecarResponse(
  value: UntrustedInput,
): value is SidecarResponse {
  const record = parseUntrustedRecord(value)
  return (
    record !== null &&
    parseFiniteNumber(record.id) !== null &&
    parseBoolean(record.ok) !== null
  )
}
