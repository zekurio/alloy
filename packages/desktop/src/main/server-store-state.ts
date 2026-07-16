import {
  DEFAULT_RECORDING_SETTINGS,
  normalizeRecordingSettings,
  type DesktopSavedServer,
  type RecordingSettings,
} from "@alloy/contracts"

export interface DesktopState {
  servers: DesktopSavedServer[]
  recording: RecordingSettings
  /** Stable identity for this install, registered with the server for sync. */
  deviceId: string | null
}

export const MAX_SAVED_SERVERS = 8
export const EMPTY_STATE: DesktopState = {
  servers: [],
  recording: DEFAULT_RECORDING_SETTINGS,
  deviceId: null,
}

export function normalizeState(parsed: Record<string, unknown>): DesktopState {
  const servers = Array.isArray(parsed.servers)
    ? parsed.servers
        .map(normalizeSavedServer)
        .filter((server): server is DesktopSavedServer => server !== null)
    : []

  return {
    servers: dedupeServers(servers).slice(0, MAX_SAVED_SERVERS),
    recording: normalizeRecordingSettings(parsed.recording),
    deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : null,
  }
}

export function upsertServer(
  servers: DesktopSavedServer[],
  serverUrl: string,
  now: Date = new Date(),
): DesktopSavedServer[] {
  return dedupeServers([
    { serverUrl, lastConnectedAt: now.toISOString() },
    ...servers.filter((server) => server.serverUrl !== serverUrl),
  ]).slice(0, MAX_SAVED_SERVERS)
}

function normalizeSavedServer(value: unknown): DesktopSavedServer | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.serverUrl !== "string") return null
  return {
    serverUrl: record.serverUrl,
    lastConnectedAt:
      typeof record.lastConnectedAt === "string"
        ? record.lastConnectedAt
        : new Date(0).toISOString(),
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
