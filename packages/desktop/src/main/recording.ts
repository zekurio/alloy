import { existsSync } from "node:fs"
import { join } from "node:path"

import type {
  RecordingActionResult,
  RecordingDisplay,
  RecordingGameProcess,
  SaveReplayClipRequest,
  RecordingStatus,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import {
  finalizeRecordingCapture,
  statusWithCapture,
} from "./recording-capture-finalize"
import { ensureRecordingDiscordDetectionsCache } from "./recording-discord-detections"
import { listElectronRecordingDisplays } from "./recording-displays"
import {
  emitRecordingEvent,
  emitRecordingStatusEvent,
} from "./recording-events"
import { rememberRecordingLibraryCapture } from "./recording-library"
import { setRecordingNotificationSoundPlayer } from "./recording-notification-sounds"
import {
  RecordingSidecarClient,
  type SidecarConfig,
} from "./recording-sidecar-client"
import { obsRuntimeDir, sidecarExecutablePath } from "./recording-sidecar-paths"
import { withReplayBufferStartSoundSuppressed } from "./recording-sound-policy"
import {
  getLastRecordingStatus,
  rememberRecordingStatus,
} from "./recording-status-state"
import {
  currentOutputFolder,
  defaultReplayScratchFolder,
} from "./recording-storage"
import { getRecordingSettings } from "./server-store"

export {
  onRecordingEvent,
  onRecordingClipHotkey,
  onRecordingScreenshotHotkey,
  emitRecordingSettingsEvent,
  emitRecordingLibraryDownloadEvent,
} from "./recording-events"

function sidecarMissingMessage(): string {
  if (app.isPackaged) {
    return t(
      "Recording is unavailable because the capture component is missing. Try reinstalling Alloy.",
    )
  }
  return t(
    "Alloy's native agent is not built yet. Run pnpm --filter @alloy/recorder build.",
  )
}

export function saveScreenshot(): Promise<RecordingActionResult> {
  return runRecordingAction("saveScreenshot")
}
let sidecarClient: RecordingSidecarClient | null = null

export { getRecordingStorageInfo } from "./recording-storage"

const logger = createLogger("recording")

setRecordingNotificationSoundPlayer((path, volume) => {
  const client = getSidecarClient()
  if (!client) return Promise.resolve()
  return client
    .request("playNotificationSound", { path, volume })
    .then(() => undefined)
})

export async function getRecordingStatus(): Promise<RecordingStatus> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingStatus()

  try {
    const status = await client.request("status")
    rememberRecordingStatus(status)
    return status
  } catch (cause) {
    const status = errorRecordingStatus(
      errorText(cause, t("Alloy agent failed.")),
    )
    rememberRecordingStatus(status)
    return status
  }
}

export async function listGameProcesses(): Promise<RecordingGameProcess[]> {
  const client = getSidecarClient()
  if (!client) return []

  try {
    return await client.request("listGameProcesses")
  } catch (cause) {
    logger.warn("failed to list game processes:", cause)
    return []
  }
}

export async function listRecordingDisplays(): Promise<RecordingDisplay[]> {
  const client = getSidecarClient()
  const obsDisplays = client
    ? await client.request("listDisplays").catch((cause) => {
        logger.warn("failed to list OBS displays:", cause)
        return []
      })
    : []

  return listElectronRecordingDisplays(obsDisplays)
}

/**
 * Push the current settings to the agent. This is the only path that
 * reconfigures it: call it at startup and whenever settings change. Status
 * reads and recording actions rely on the config already being pushed.
 */
export async function configureRecordingBackend(): Promise<RecordingStatus> {
  sidecarBlockedForInstall = false
  const client = getSidecarClient()
  if (!client) {
    const status = unavailableRecordingStatus()
    emitRecordingStatusEvent(status)
    return status
  }
  try {
    // Reconfiguring restarts an active replay buffer inside the sidecar;
    // suppress the start chime so settings changes stay silent.
    const suppressStartSound = getLastRecordingStatus()?.replayActive === true
    const status = await withReplayBufferStartSoundSuppressed(
      suppressStartSound,
      () => client.configure(currentSidecarConfig()),
    )
    rememberRecordingStatus(status)
    emitRecordingStatusEvent(status)
    return status
  } catch (cause) {
    const status = errorRecordingStatus(
      errorText(cause, t("Alloy agent failed.")),
    )
    rememberRecordingStatus(status)
    emitRecordingStatusEvent(status)
    return status
  }
}

export async function saveReplayClip(
  request: SaveReplayClipRequest,
): Promise<RecordingActionResult> {
  return runRecordingAction("saveReplayClip", request)
}

/**
 * Keep live audio-level events flowing from the sidecar. The subscription
 * auto-expires after a few seconds, so the renderer re-sends this as a
 * heartbeat while a meter UI is visible (which also survives sidecar respawns).
 */
export async function subscribeRecordingAudioLevels(): Promise<void> {
  const client = getSidecarClient()
  if (!client) return
  try {
    await client.request("subscribeAudioLevels")
  } catch (cause) {
    logger.warn("failed to subscribe to audio levels:", cause)
  }
}

export async function stopAudioLevels(): Promise<void> {
  const client = getSidecarClient()
  if (!client) return
  try {
    await client.request("stopAudioLevels")
  } catch (cause) {
    logger.warn("failed to stop audio levels:", cause)
  }
}

/** Resolves false when a sidecar process may still be running afterwards. */
export async function shutdownRecordingBackend(): Promise<boolean> {
  const client = sidecarClient
  sidecarClient = null
  return (await client?.shutdown()) ?? true
}

let sidecarBlockedForInstall = false

/**
 * Stops the sidecar and blocks respawns until the next
 * `configureRecordingBackend` call, so no recording entry point (IPC,
 * hotkeys, sounds) can spawn a fresh recorder — holding the packaged OBS
 * DLLs open — while the NSIS installer replaces the app.
 */
export async function stopRecordingBackendForInstall(): Promise<boolean> {
  sidecarBlockedForInstall = true
  return shutdownRecordingBackend()
}

export async function restartRecordingBackend(): Promise<RecordingStatus> {
  const stopped = await shutdownRecordingBackend()
  if (!stopped) {
    logger.warn("previous Alloy agent may still be exiting; spawning a new one")
  }
  return configureRecordingBackend()
}

async function runRecordingAction(
  method: "saveReplayClip" | "saveScreenshot",
  params?: SaveReplayClipRequest,
): Promise<RecordingActionResult> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingAction()

  try {
    const result = await client.request(method, params)
    if (!result.ok || !result.capture) {
      rememberRecordingStatus(result.status)
      return result
    }

    const capture = await finalizeRecordingCapture(result.capture)
    const status = statusWithCapture(result.status, capture)
    rememberRecordingStatus(status)
    rememberRecordingLibraryCapture(capture)
    return { ...result, status, capture }
  } catch (cause) {
    const message = errorText(cause, t("Alloy agent failed."))
    const status = errorRecordingStatus(message)
    rememberRecordingStatus(status)
    return {
      ok: false,
      error: message,
      status,
    }
  }
}

function currentSidecarConfig(): SidecarConfig {
  const settings = getRecordingSettings()
  return {
    settings,
    agentStateFolder: join(app.getPath("userData"), "agent"),
    outputFolder: currentOutputFolder(),
    replayScratchFolder: defaultReplayScratchFolder(),
    obsRuntimeDir: obsRuntimeDir(),
    discordDetectionCachePath: ensureRecordingDiscordDetectionsCache(),
  }
}

function getSidecarClient(): RecordingSidecarClient | null {
  if (sidecarBlockedForInstall) return null
  if (sidecarClient) return sidecarClient

  const executable = sidecarExecutablePath()
  if (!existsSync(executable)) return null

  sidecarClient = new RecordingSidecarClient(executable, {
    initialStatus: unavailableRecordingStatus(),
    config: currentSidecarConfig,
    emitEvent: emitRecordingEvent,
  })
  return sidecarClient
}

function unavailableRecordingStatus(
  message = sidecarMissingMessage(),
  backend: RecordingStatus["backend"] = "missing",
): RecordingStatus {
  const settings = getRecordingSettings()
  return {
    backend,
    mode: "idle",
    captureMode: settings.captureMode,
    runState: backend === "error" ? "error" : "idle",
    replayActive: false,
    activeGame: null,
    activeGameDetail: null,
    activeDisplay: null,
    focused: false,
    currentSource: null,
    currentCapture: null,
    replayBufferSeconds: settings.replayBufferSeconds,
    availableGpus: [],
    availableCodecs: ["h264"],
    availableAudioDevices: [],
    availableAudioApplications: settings.audioApplications,
    telemetry: null,
    message,
  }
}

function unavailableRecordingAction(
  message = sidecarMissingMessage(),
): RecordingActionResult {
  const status = unavailableRecordingStatus(message)
  rememberRecordingStatus(status)
  return {
    ok: false,
    error: message,
    status,
  }
}

function errorRecordingStatus(message: string): RecordingStatus {
  return unavailableRecordingStatus(message, "error")
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
