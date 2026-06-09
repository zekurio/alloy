import { existsSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import type {
  RecordingActionResult,
  RecordingCapture,
  RecordingEvent,
  RecordingGameProcess,
  RecordingStatus,
} from "alloy-contracts"
import { logger } from "alloy-logging"
import { app } from "electron"

import { playRecordingNotificationSound } from "./recording-notification-sounds"
import {
  RecordingSidecarClient,
  type SidecarConfig,
} from "./recording-sidecar-client"
import {
  currentOutputFolder,
  defaultReplayScratchFolder,
} from "./recording-storage"
import { getRecordingSettings } from "./server-store"

const SIDECAR_MISSING =
  "Recording capture sidecar is not built yet. Run pnpm --filter alloy-recorder build."

type RecordingEventListener = (event: RecordingEvent) => void

const recordingEventListeners = new Set<RecordingEventListener>()
let sidecarClient: RecordingSidecarClient | null = null
let lastRecordingStartSoundKey: string | null = null
let lastClipSavedSoundKey: string | null = null
let lastRecordingStatus: RecordingStatus | null = null
let pendingReplaySaveRequestSounds = 0

export {
  defaultOutputFolder,
  defaultReplayScratchFolder,
  getRecordingStorageInfo,
  resolveRevealableCapturePath,
} from "./recording-storage"

export async function getRecordingStatus(): Promise<RecordingStatus> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingStatus()

  try {
    await client.configure(currentSidecarConfig())
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

export async function configureRecordingBackend(): Promise<RecordingStatus> {
  const client = getSidecarClient()
  if (!client) {
    const status = unavailableRecordingStatus()
    emitRecordingStatusEvent(status)
    return status
  }
  try {
    const status = await client.configure(currentSidecarConfig())
    emitRecordingStatusEvent(status)
    return status
  } catch (cause) {
    const status = errorRecordingStatus(
      errorText(cause, "Recording sidecar failed."),
    )
    emitRecordingStatusEvent(status)
    return status
  }
}

export async function saveReplayClip(): Promise<RecordingActionResult> {
  return runRecordingAction("saveReplayClip")
}

export async function stopRecording(): Promise<RecordingActionResult> {
  return runRecordingAction("stopRecording")
}

export async function shutdownRecordingBackend(): Promise<void> {
  const client = sidecarClient
  sidecarClient = null
  await client?.shutdown()
}

export function unavailableRecordingStatus(
  message = SIDECAR_MISSING,
  backend: RecordingStatus["backend"] = "missing",
): RecordingStatus {
  const settings = getRecordingSettings()
  return {
    backend,
    mode: "idle",
    triggerMode: settings.triggerMode,
    runState: backend === "error" ? "error" : "idle",
    activeGame: null,
    activeGameDetail: null,
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

export function unavailableRecordingAction(
  message = SIDECAR_MISSING,
): RecordingActionResult {
  const status = unavailableRecordingStatus(message)
  rememberRecordingStatus(status)
  return {
    ok: false,
    error: message,
    status,
  }
}

export function playReplaySaveRequestedSound(): boolean {
  if (!canReplayBufferSaveFromStatus(lastRecordingStatus)) return false

  pendingReplaySaveRequestSounds += 1
  playClipSavedSound(
    `requested:${Date.now()}:${pendingReplaySaveRequestSounds}`,
  )
  return true
}

export function cancelReplaySaveRequestedSoundSuppression(): void {
  if (pendingReplaySaveRequestSounds > 0) pendingReplaySaveRequestSounds -= 1
}

async function runRecordingAction(
  method: "saveReplayClip" | "stopRecording",
): Promise<RecordingActionResult> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingAction()

  try {
    await client.configure(currentSidecarConfig())
    const result = await client.request<RecordingActionResult>(method)
    rememberRecordingStatus(result.status)
    return result
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
    runtimeDir: obsRuntimeDir,
    emitEvent: emitRecordingEvent,
  })
  return sidecarClient
}

function sidecarExecutablePath(): string {
  const executable =
    process.platform === "win32" ? "alloy-recorder.exe" : "alloy-recorder"
  if (app.isPackaged) return join(process.resourcesPath, "sidecar", executable)
  return join(app.getAppPath(), "..", "recorder", "dist", "sidecar", executable)
}

function obsRuntimeDir(): string | null {
  const configured = process.env.ALLOY_OBS_RUNTIME_DIR
  const configuredRuntime = configured
    ? normalizeObsRuntimeDir(configured)
    : null
  if (configuredRuntime) return configuredRuntime

  const bundled = app.isPackaged
    ? join(process.resourcesPath, "obs-runtime")
    : join(app.getAppPath(), "..", "recorder", "dist", "obs-runtime")
  const bundledRuntime = normalizeObsRuntimeDir(bundled)
  if (bundledRuntime) return bundledRuntime

  for (const candidate of systemObsRuntimeCandidates()) {
    const runtime = normalizeObsRuntimeDir(candidate)
    if (runtime) return runtime
  }

  return null
}

function normalizeObsRuntimeDir(candidate: string): string | null {
  if (!existsSync(candidate)) return null

  const resolved = resolve(candidate)
  if (
    basenameInsensitive(resolved) === "64bit" &&
    basenameInsensitive(dirname(resolved)) === "bin"
  ) {
    const root = dirname(dirname(resolved))
    if (hasObsLibrary(join(root, "bin", "64bit"))) return root
  }

  if (basenameInsensitive(resolved) === "bin") {
    const root = dirname(resolved)
    if (hasObsLibrary(join(root, "bin"))) return root
  }

  if (hasObsLibrary(resolved)) return resolved
  if (hasObsLibrary(join(resolved, "bin", "64bit"))) return resolved
  if (hasObsLibrary(join(resolved, "bin"))) return resolved

  return null
}

function hasObsLibrary(candidate: string): boolean {
  return existsSync(join(candidate, "obs.dll"))
}

function systemObsRuntimeCandidates(): string[] {
  if (process.platform !== "win32") return []

  return [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ]
    .filter((path): path is string => Boolean(path))
    .map((path) => join(path, "obs-studio"))
}

function basenameInsensitive(path: string): string {
  return basename(path).toLowerCase()
}

function emitRecordingEvent(event: RecordingEvent) {
  if ("status" in event) rememberRecordingStatus(event.status)
  maybePlayRecordingEventSound(event)
  for (const listener of recordingEventListeners) {
    listener(event)
  }
}

function maybePlayRecordingEventSound(event: RecordingEvent): void {
  maybePlayRecordingStartedSound(event)
  if (event.type === "capture-ready") {
    maybePlayClipSavedSound(event.capture)
  }
}

function maybePlayRecordingStartedSound(event: RecordingEvent): void {
  if (event.type !== "status") return

  const soundKey = recordingStartSoundKey(event.status)
  if (!soundKey) {
    lastRecordingStartSoundKey = null
    return
  }
  if (lastRecordingStartSoundKey === soundKey) return
  lastRecordingStartSoundKey = soundKey

  const sounds = getRecordingSettings().notificationSounds
  void playRecordingNotificationSound(
    "recordingStarted",
    sounds.recordingStarted,
  )
}

function recordingStartSoundKey(status: RecordingStatus): string | null {
  if (status.backend !== "ready") return null
  if (status.mode !== "recording" && status.mode !== "replay-buffer") {
    return null
  }

  const game = status.activeGameDetail
  return [
    status.triggerMode,
    status.activeGame ?? "",
    game?.id ?? "",
    game?.processId ?? "",
    game?.startedAt ?? "",
  ].join(":")
}

function errorRecordingStatus(message: string): RecordingStatus {
  return unavailableRecordingStatus(message, "error")
}

function maybePlayClipSavedSound(capture: RecordingCapture): void {
  if (capture.triggerMode !== "replay-buffer") return

  const soundKey = capture.id || capture.filename
  if (pendingReplaySaveRequestSounds > 0) {
    pendingReplaySaveRequestSounds -= 1
    lastClipSavedSoundKey = soundKey
    return
  }

  playClipSavedSound(soundKey)
}

function playClipSavedSound(soundKey: string): void {
  if (lastClipSavedSoundKey === soundKey) return
  lastClipSavedSoundKey = soundKey

  const sounds = getRecordingSettings().notificationSounds
  void playRecordingNotificationSound("clipSaved", sounds.clipSaved)
}

function canReplayBufferSaveFromStatus(
  status: RecordingStatus | null,
): boolean {
  return (
    status?.backend === "ready" &&
    status.mode === "replay-buffer" &&
    status.runState === "replay-buffer"
  )
}

function rememberRecordingStatus(status: RecordingStatus): void {
  lastRecordingStatus = status
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
