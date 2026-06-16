import {
  DEFAULT_RECORDING_SETTINGS,
  normalizeDesktopUpdateChannel,
  normalizeRecordingSettings,
  type DesktopUpdateChannel,
  type RecordingSettings,
} from "@alloy/contracts"

import type { SavedServer } from "@/shared/ipc"

export interface DesktopState {
  servers: SavedServer[]
  recording: RecordingSettings
  /** Explicit update channel selection; null follows the installed build. */
  updateChannel: DesktopUpdateChannel | null
  /** Stable identity for this install, registered with the server for sync. */
  deviceId: string | null
}

export const MAX_SAVED_SERVERS = 8
export const EMPTY_STATE: DesktopState = {
  servers: [],
  recording: DEFAULT_RECORDING_SETTINGS,
  updateChannel: null,
  deviceId: null,
}

export function normalizeState(parsed: Record<string, unknown>): DesktopState {
  const servers = Array.isArray(parsed.servers)
    ? parsed.servers
        .map(normalizeSavedServer)
        .filter((server): server is SavedServer => server !== null)
    : []

  return {
    servers: dedupeServers(servers).slice(0, MAX_SAVED_SERVERS),
    recording: normalizeRecordingSettings(parsed.recording),
    updateChannel: normalizeDesktopUpdateChannel(parsed.updateChannel),
    deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : null,
  }
}

export function upsertServer(
  servers: SavedServer[],
  serverUrl: string,
  now: Date = new Date(),
): SavedServer[] {
  return dedupeServers([
    { serverUrl, lastConnectedAt: now.toISOString() },
    ...servers.filter((server) => server.serverUrl !== serverUrl),
  ]).slice(0, MAX_SAVED_SERVERS)
}

function normalizeSavedServer(value: unknown): SavedServer | null {
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

function dedupeServers(servers: SavedServer[]): SavedServer[] {
  const seen = new Set<string>()
  const unique: SavedServer[] = []
  for (const server of servers) {
    if (seen.has(server.serverUrl)) continue
    seen.add(server.serverUrl)
    unique.push(server)
  }
  return unique
}
