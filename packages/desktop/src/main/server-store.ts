import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import {
  normalizeRecordingSettings,
  type RecordingSettings,
} from "alloy-contracts"
import { logger } from "alloy-logging"
import { app } from "electron"

import type { SavedServer } from "../shared/ipc"
import {
  EMPTY_STATE,
  type DesktopState,
  normalizeState,
  upsertServer,
} from "./server-store-state"

/**
 * Tiny JSON store for desktop-local preferences that must survive restarts.
 * Lives in Electron's per-user `userData` dir, separate from the session
 * partition (which holds the auth cookie). Kept deliberately minimal — this is
 * client config, not a cache.
 */
const STATE_FILE = "desktop-state.json"
const LEGACY_USER_DATA_DIR_NAME = "Alloy"
const LEGACY_DESKTOP_USER_DATA_DIR_NAME = "Alloy Desktop"

function stateFilePaths(): string[] {
  const primary = join(app.getPath("userData"), STATE_FILE)
  const legacyPaths = [
    join(app.getPath("appData"), LEGACY_DESKTOP_USER_DATA_DIR_NAME, STATE_FILE),
    join(app.getPath("appData"), LEGACY_USER_DATA_DIR_NAME, STATE_FILE),
  ]
  return [primary, ...legacyPaths.filter((path) => path !== primary)]
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
    logger.error("[desktop] failed to persist state:", error)
  }
}

export function getLastServerUrl(): string | null {
  const state = readState()
  return state.servers[0]?.serverUrl ?? state.lastServerUrl
}

export function getSavedServers(): SavedServer[] {
  return readState().servers
}

export function rememberServer(serverUrl: string): SavedServer[] {
  const state = readState()
  const servers = upsertServer(state.servers, serverUrl)
  writeState({ ...state, lastServerUrl: serverUrl, servers })
  return servers
}

export function forgetServer(serverUrl: string): SavedServer[] {
  const state = readState()
  const servers = state.servers.filter(
    (server) => server.serverUrl !== serverUrl,
  )
  const lastServerUrl =
    state.lastServerUrl === serverUrl
      ? (servers[0]?.serverUrl ?? null)
      : state.lastServerUrl
  writeState({ ...state, lastServerUrl, servers })
  return servers
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
