import {
  DEFAULT_RECORDING_SETTINGS,
  normalizeRecordingSettings,
  type DesktopSavedServer,
  type RecordingSettings,
} from "@alloy/contracts"

import {
  parseNonnegativeInteger,
  parseString,
  parseUntrustedRecord,
  type UntrustedInput,
  type UntrustedRecord,
} from "./runtime-validation"

export interface DesktopState {
  version: 2
  servers: DesktopSavedServer[]
  recording: RecordingSettings
  /** Stable identity for this install, registered with the server for sync. */
  deviceId: string | null
}

export const MAX_SAVED_SERVERS = 8
export const EMPTY_STATE: DesktopState = {
  version: 2,
  servers: [],
  recording: DEFAULT_RECORDING_SETTINGS,
  deviceId: null,
}

export function normalizeState(parsed: UntrustedRecord): DesktopState {
  if (parsed.version !== 2) return EMPTY_STATE
  const servers = Array.isArray(parsed.servers)
    ? parsed.servers
        .map(normalizeSavedServer)
        .filter((server): server is DesktopSavedServer => server !== null)
    : []

  return {
    version: 2,
    servers: dedupeServers(servers).slice(0, MAX_SAVED_SERVERS),
    recording: normalizeRecordingSettings(parsed.recording),
    deviceId: parseString(parsed.deviceId),
  }
}

export function upsertServer(
  servers: DesktopSavedServer[],
  serverUrl: string,
  httpContract: number,
  bridgeContract: number,
  now: Date = new Date(),
): DesktopSavedServer[] {
  return dedupeServers([
    {
      serverUrl,
      lastConnectedAt: now.toISOString(),
      httpContract,
      bridgeContract,
    },
    ...servers.filter((server) => server.serverUrl !== serverUrl),
  ]).slice(0, MAX_SAVED_SERVERS)
}

function normalizeSavedServer(
  value: UntrustedInput,
): DesktopSavedServer | null {
  const record = parseUntrustedRecord(value)
  const serverUrl = parseString(record?.serverUrl)
  if (serverUrl === null) return null
  const parsedContract = parseNonnegativeInteger(record?.httpContract)
  const parsedBridgeContract = parseNonnegativeInteger(record?.bridgeContract)
  return {
    serverUrl,
    lastConnectedAt:
      parseString(record?.lastConnectedAt) ?? new Date(0).toISOString(),
    // Missing compatibility fields belong to the bundled-renderer era. Keep
    // them saved for display, but force a fresh probe before remote startup.
    httpContract: parsedContract ?? 0,
    bridgeContract: parsedBridgeContract ?? 0,
  }
}

function dedupeServers(servers: DesktopSavedServer[]): DesktopSavedServer[] {
  const seen = new Set<string>()
  const unique: DesktopSavedServer[] = []
  for (const server of servers) {
    if (seen.has(server.serverUrl)) continue
    seen.add(server.serverUrl)
    unique.push(server)
  }
  return unique
}
