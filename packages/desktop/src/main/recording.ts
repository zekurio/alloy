import { existsSync } from "node:fs"

import type {
  RecordingActionResult,
  RecordingActionRequest,
  RecordingCapture,
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingLibraryDownload,
  SaveReplayClipRequest,
  RecordingStatus,
} from "@alloy/contracts"
import { logger } from "@alloy/logging"
import { app } from "electron"

import { finalizeRecordingCapture } from "./recording-capture-finalize"
import { listRecordingDisplays as listElectronRecordingDisplays } from "./recording-displays"
import { rememberRecordingLibraryCapture } from "./recording-library"
import { takeRecordingScreenshot as takeElectronRecordingScreenshot } from "./recording-screenshot"
import {
  RecordingSidecarClient,
  type SidecarConfig,
} from "./recording-sidecar-client"
import { obsRuntimeDir, sidecarExecutablePath } from "./recording-sidecar-paths"
import {
  handleRecordingEventSound,
  playNotificationSound,
  requestReplaySaveSound,
  withRecordingStartSoundSuppressed,
} from "./recording-sound-policy"
import {
  currentOutputFolder,
  defaultReplayScratchFolder,
} from "./recording-storage"
import { getRecordingSettings } from "./server-store"

function sidecarMissingMessage(): string {
  if (app.isPackaged) {
    return "Recording is unavailable because the capture component is missing. Try reinstalling Alloy."
  }
  return "Recording capture sidecar is not built yet. Run pnpm --filter @alloy/recorder build."
}

type RecordingEventListener = (event: RecordingEvent) => void

const recordingEventListeners = new Set<RecordingEventListener>()
let sidecarClient: RecordingSidecarClient | null = null
let lastRecordingStatus: RecordingStatus | null = null

export {
  defaultOutputFolder,
  defaultReplayScratchFolder,
  getRecordingStorageInfo,
  resolveRevealableCapturePath,
} from "./recording-storage"
export { cancelReplaySaveRequestedSoundSuppression } from "./recording-sound-policy"

export async function getRecordingStatus(): Promise<RecordingStatus> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingStatus()

  try {
    const status = await client.request<RecordingStatus>("status")
    rememberRecordingStatus(status)
    return status
  } catch (cause) {
    const status = errorRecordingStatus(
      errorText(cause, "Recording sidecar failed."),
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
    logger.warn("[desktop] failed to list game processes:", cause)
    return []
  }
}

export async function listRecordingDisplays(): Promise<RecordingDisplay[]> {
  const client = getSidecarClient()
  const obsDisplays = client
    ? await client
        .request<RecordingDisplay[]>("listDisplays")
        .catch((cause) => {
          logger.warn("[desktop] failed to list OBS displays:", cause)
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
    const suppressStartSound = lastRecordingStatus?.replayActive === true
    const status = await withRecordingStartSoundSuppressed(
      suppressStartSound,
      () => client.configure(currentSidecarConfig()),
    )
    rememberRecordingStatus(status)
    emitRecordingStatusEvent(status)
    return status
  } catch (cause) {
    const status = errorRecordingStatus(
      errorText(cause, "Recording sidecar failed."),
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

export async function addRecordingBookmark(
  request: RecordingActionRequest,
): Promise<RecordingActionResult> {
  const result = await runRecordingAction("addBookmark", request)
  if (result.ok && canBookmarkFromStatus(result.status)) {
    playNotificationSound("bookmarkAdded")
  }
  return result
}

export async function takeRecordingScreenshot(
  request: RecordingActionRequest,
): Promise<RecordingActionResult> {
  const status = await getRecordingStatus()
  const displays = await listRecordingDisplays()
  const result = await takeElectronRecordingScreenshot({
    displays,
    request,
    settings: getRecordingSettings(),
    status,
  })
  if (result.ok && result.capture?.kind === "screenshot") {
    rememberRecordingLibraryCapture(result.capture)
    playNotificationSound("screenshotTaken")
  }
  return result
}

export async function toggleLongRecording(
  request: RecordingActionRequest,
): Promise<RecordingActionResult> {
  const wasLongRecording = lastRecordingStatus?.longRecordingActive === true
  const result = await runRecordingAction("toggleLongRecording", request)
  if (result.ok && !wasLongRecording && result.status.longRecordingActive) {
    playNotificationSound("manualRecordingStarted")
  }
  return result
}

export async function stopRecording(): Promise<RecordingActionResult> {
  return runRecordingAction("stopRecording")
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
    logger.warn("[desktop] failed to subscribe to audio levels:", cause)
  }
}

export async function stopRecordingAudioLevels(): Promise<void> {
  const client = getSidecarClient()
  if (!client) return
  try {
    await client.request("stopAudioLevels")
  } catch (cause) {
    logger.warn("[desktop] failed to stop audio levels:", cause)
  }
}

export async function shutdownRecordingBackend(): Promise<void> {
  const client = sidecarClient
  sidecarClient = null
  await client?.shutdown()
}

export function playReplaySaveRequestedSound(): boolean {
  return requestReplaySaveSound(lastRecordingStatus)
}

async function runRecordingAction(
  method:
    | "saveReplayClip"
    | "addBookmark"
    | "toggleLongRecording"
    | "stopRecording",
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
    const message = errorText(cause, "Recording sidecar failed.")
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
    longRecordingActive: false,
    activeGame: null,
    activeGameDetail: null,
    activeDisplay: null,
    focused: false,
    currentSource: null,
    currentCapture: null,
    replayBufferSeconds: settings.replayBufferSeconds,
    availableGpus: [],
    availableCodecs: ["h264"],
    availableAudioDevices: settings.audioDevices,
    availableAudioApplications: settings.audioApplications,
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
    logger.warn("[desktop] failed to finalize recording capture:", cause)
  }
}

function sendRecordingEvent(event: RecordingEvent): void {
  for (const listener of recordingEventListeners) {
    listener(event)
  }
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

function canBookmarkFromStatus(status: RecordingStatus): boolean {
  return (
    status.backend === "ready" &&
    status.longRecordingActive &&
    status.runState !== "error"
  )
}

function rememberRecordingStatus(status: RecordingStatus): void {
  lastRecordingStatus = status
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
