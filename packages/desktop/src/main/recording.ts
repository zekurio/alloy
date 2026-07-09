import { existsSync } from "node:fs"

import type {
  RecordingActionResult,
  RecordingCapture,
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingLibraryDownload,
  RecordingTelemetry,
  SaveReplayClipRequest,
  RecordingStatus,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLogger } from "@alloy/logging"
import { app } from "electron"

import { finalizeRecordingCapture } from "./recording-capture-finalize"
import { ensureRecordingDiscordDetectionsCache } from "./recording-discord-detections"
import { listElectronRecordingDisplays } from "./recording-displays"
import { rememberRecordingLibraryCapture } from "./recording-library"
import { setRecordingNotificationSoundPlayer } from "./recording-notification-sounds"
import {
  RecordingSidecarClient,
  type SidecarConfig,
} from "./recording-sidecar-client"
import { obsRuntimeDir, sidecarExecutablePath } from "./recording-sidecar-paths"
import {
  handleRecordingEventSound,
  requestReplaySaveSound,
  withReplayBufferStartSoundSuppressed,
} from "./recording-sound-policy"
import {
  getLastRecordingStatus,
  rememberRecordingStatus,
} from "./recording-status-state"
import {
  currentOutputFolder,
  defaultReplayScratchFolder,
} from "./recording-storage"
import { getRecordingSettings } from "./server-store"

function sidecarMissingMessage(): string {
  if (app.isPackaged) {
    return t(
      "Recording is unavailable because the capture component is missing. Try reinstalling Alloy.",
    )
  }
  return t(
    "Recording capture sidecar is not built yet. Run pnpm --filter @alloy/recorder build.",
  )
}

type RecordingEventListener = (event: RecordingEvent) => void

const recordingEventListeners = new Set<RecordingEventListener>()
let sidecarClient: RecordingSidecarClient | null = null

export {
  defaultOutputFolder,
  defaultReplayScratchFolder,
  getRecordingStorageInfo,
  resolveRevealableCapturePath,
} from "./recording-storage"

const logger = createLogger("recording")
export { cancelReplaySaveRequestedSoundSuppression } from "./recording-sound-policy"

setRecordingNotificationSoundPlayer((path, volume) => {
  const client = getSidecarClient()
  if (!client) return Promise.resolve()
  return client.request("playNotificationSound", { path, volume })
})

export async function getRecordingStatus(): Promise<RecordingStatus> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingStatus()

  try {
    const status = await client.request<RecordingStatus>("status")
    rememberRecordingStatus(status)
    return status
  } catch (cause) {
    const status = errorRecordingStatus(
      errorText(cause, t("Recording sidecar failed.")),
    )
    rememberRecordingStatus(status)
    return status
  }
}

export async function listGameProcesses(): Promise<RecordingGameProcess[]> {
  const client = getSidecarClient()
  if (!client) return []

  try {
    return await client.request<RecordingGameProcess[]>("listGameProcesses")
  } catch (cause) {
    logger.warn("failed to list game processes:", cause)
    return []
  }
}

export async function listRecordingDisplays(): Promise<RecordingDisplay[]> {
  const client = getSidecarClient()
  const obsDisplays = client
    ? await client
        .request<RecordingDisplay[]>("listDisplays")
        .catch((cause) => {
          logger.warn("failed to list OBS displays:", cause)
          return []
        })
    : []

  return listElectronRecordingDisplays(obsDisplays)
}

export function onRecordingEvent(listener: RecordingEventListener): () => void {
  recordingEventListeners.add(listener)
  return () => recordingEventListeners.delete(listener)
}

export function emitRecordingSettingsEvent(): void {
  emitRecordingEvent({ type: "settings", settings: getRecordingSettings() })
}

export function emitRecordingStatusEvent(status: RecordingStatus): void {
  emitRecordingEvent({ type: "status", status })
}

/** Progress/terminal updates from the clip download manager. */
export function emitRecordingLibraryDownloadEvent(
  download: RecordingLibraryDownload,
): void {
  emitRecordingEvent({ type: "library-download", download })
}

/**
 * Push the current settings to the sidecar. This is the only path that
 * reconfigures it: call it at startup and whenever settings change. Status
 * reads and recording actions rely on the config already being pushed.
 */
export async function configureRecordingBackend(): Promise<RecordingStatus> {
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
      errorText(cause, t("Recording sidecar failed.")),
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

export async function shutdownRecordingBackend(): Promise<void> {
  const client = sidecarClient
  sidecarClient = null
  await client?.shutdown()
}

export async function restartRecordingBackend(): Promise<RecordingStatus> {
  await shutdownRecordingBackend()
  return configureRecordingBackend()
}

export function playReplaySaveRequestedSound(): boolean {
  return requestReplaySaveSound(getLastRecordingStatus())
}

async function runRecordingAction(
  method: "saveReplayClip",
  params?: unknown,
): Promise<RecordingActionResult> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingAction()

  try {
    const result = await client.request<RecordingActionResult>(method, params)
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
    const message = errorText(cause, t("Recording sidecar failed."))
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
    outputFolder: currentOutputFolder(),
    replayScratchFolder: defaultReplayScratchFolder(),
    obsRuntimeDir: obsRuntimeDir(),
    discordDetectionCachePath: ensureRecordingDiscordDetectionsCache(),
  }
}

function getSidecarClient(): RecordingSidecarClient | null {
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

function emitRecordingEvent(event: RecordingEvent): void {
  if (event.type === "telemetry") {
    logRecordingTelemetry(event.telemetry)
  } else if (event.type === "capture-ready" && event.status.telemetry) {
    logRecordingTelemetry(event.status.telemetry, "capture")
  }

  if (event.type === "capture-ready") {
    handleRecordingEventSound(event)
    void emitFinalizedCaptureReady(event)
    return
  }
  if ("status" in event) rememberRecordingStatus(event.status)
  handleRecordingEventSound(event)
  sendRecordingEvent(event)
}

async function emitFinalizedCaptureReady(
  event: Extract<RecordingEvent, { type: "capture-ready" }>,
): Promise<void> {
  try {
    const capture = await finalizeRecordingCapture(event.capture)
    const finalized = {
      ...event,
      capture,
      status: statusWithCapture(event.status, capture),
    }
    rememberRecordingStatus(finalized.status)
    rememberRecordingLibraryCapture(capture)
    sendRecordingEvent(finalized)
  } catch (cause) {
    logger.warn("failed to finalize recording capture:", cause)
  }
}

function sendRecordingEvent(event: RecordingEvent): void {
  for (const listener of recordingEventListeners) {
    listener(event)
  }
}

function logRecordingTelemetry(
  telemetry: RecordingTelemetry,
  reason = "sample",
): void {
  logger.info(
    "recorder telemetry",
    JSON.stringify({
      reason,
      sampledAt: telemetry.sampledAt,
      captureMode: telemetry.captureMode,
      source: telemetry.captureSource,
      storage: telemetry.bufferStorage,
      encoder: telemetry.encoder,
      codec: telemetry.codec,
      videoEncoder: telemetry.videoEncoder,
      audioEncoder: telemetry.audioEncoder,
      gpu: telemetry.gpu,
      gpuAdapter: telemetry.gpuAdapter,
      gpuLabel: telemetry.gpuLabel,
      dimensions: `${telemetry.outputWidth}x${telemetry.outputHeight}@${telemetry.fps}`,
      baseDimensions: `${telemetry.baseWidth}x${telemetry.baseHeight}`,
      bitrateKbps: telemetry.bitrateKbps,
      outputActive: telemetry.outputActive,
      paused: telemetry.paused,
      activeFps: telemetry.activeFps,
      averageFrameTimeMs: telemetry.averageFrameTimeMs,
      frameIntervalMs: telemetry.frameIntervalMs,
      render: {
        totalFrames: telemetry.renderTotalFrames,
        laggedFrames: telemetry.renderLaggedFrames,
        laggedPercent: telemetry.renderLaggedPercent,
      },
      output: {
        totalFrames: telemetry.outputTotalFrames,
        droppedFrames: telemetry.outputDroppedFrames,
        droppedPercent: telemetry.outputDroppedPercent,
        totalBytes: telemetry.outputTotalBytes,
      },
    }),
  )
}

function statusWithCapture(
  status: RecordingStatus,
  capture: RecordingCapture,
): RecordingStatus {
  return {
    ...status,
    currentCapture:
      status.currentCapture?.filename === capture.filename
        ? capture
        : status.currentCapture,
  }
}

function errorRecordingStatus(message: string): RecordingStatus {
  return unavailableRecordingStatus(message, "error")
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
