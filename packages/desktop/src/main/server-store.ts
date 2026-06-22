import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import {
  normalizeRecordingSettings,
  type DesktopUpdateChannel,
  type RecordingSettings,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import type { SavedServer } from "@/shared/ipc"

import {
  EMPTY_STATE,
  type DesktopState,
  normalizeState,
  upsertServer,
} from "./server-store-state"

const logger = createLogger("store")

/**
 * Tiny JSON store for desktop-local preferences that must survive restarts.
 * Lives in Electron's per-user `userData` dir, separate from the session
 * partition (which holds the auth cookie). Kept deliberately minimal — this is
 * client config, not a cache.
 */
const STATE_FILE = "preferences.json"

function stateFilePaths(): string[] {
  return [join(app.getPath("userData"), STATE_FILE)]
}

function readState(): DesktopState {
  for (const path of stateFilePaths()) {
    try {
      const raw = readFileSync(path, "utf8")
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === "object" && parsed !== null) {
        return normalizeState(parsed as Record<string, unknown>)
      }
    } catch {
      // Missing or corrupt state is expected on first launch — try fallback.
    }
  }
  return EMPTY_STATE
}

function writeState(state: DesktopState): void {
  try {
    const path = stateFilePaths()[0]
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), "utf8")
  } catch (error) {
    logger.error("failed to persist state:", error)
  }
}

export function getStartupServerUrl(): string | null {
  const state = readState()
  return state.servers[0]?.serverUrl ?? null
}

export function getSavedServers(): SavedServer[] {
  return readState().servers
}

export function rememberServer(serverUrl: string): SavedServer[] {
  const state = readState()
  const servers = upsertServer(state.servers, serverUrl)
  writeState({ ...state, servers })
  return servers
}

export function forgetServer(serverUrl: string): SavedServer[] {
  const state = readState()
  const servers = state.servers.filter(
    (server) => server.serverUrl !== serverUrl,
  )
  writeState({ ...state, servers })
  return servers
}

/**
 * Stable per-install device id used for server-side clip ownership. Created
 * lazily on first use; `replaceDeviceId` handles the (unlikely) server-side
 * id collision by minting a fresh identity.
 */
export function getOrCreateDeviceId(): string {
  const state = readState()
  if (state.deviceId) return state.deviceId
  const deviceId = crypto.randomUUID()
  writeState({ ...state, deviceId })
  return deviceId
}

export function replaceDeviceId(): string {
  const state = readState()
  const deviceId = crypto.randomUUID()
  writeState({ ...state, deviceId })
  return deviceId
}

export function getRecordingSettings(): RecordingSettings {
  return readState().recording
}

export function saveRecordingSettings(
  settings: RecordingSettings,
): RecordingSettings {
  const state = readState()
  const recording = normalizeRecordingSettings(settings)
  writeState({ ...state, recording })
  return recording
}

export function getSavedUpdateChannelOverride(): DesktopUpdateChannel | null {
  return readState().updateChannelOverride
}

export function saveUpdateChannelOverride(
  channel: DesktopUpdateChannel | null,
): DesktopUpdateChannel | null {
  const state = readState()
  writeState({ ...state, updateChannelOverride: channel })
  return channel
}
