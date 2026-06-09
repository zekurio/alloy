import { existsSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import type {
  RecordingActionResult,
  RecordingActionRequest,
  RecordingCapture,
  RecordingDisplay,
  RecordingEvent,
  RecordingGameProcess,
  RecordingNotificationSoundEvent,
  SaveReplayClipRequest,
  RecordingStatus,
} from "alloy-contracts"
import { logger } from "alloy-logging"
import { app } from "electron"

import { listRecordingDisplays as listElectronRecordingDisplays } from "./recording-displays"
import { playRecordingNotificationSound } from "./recording-notification-sounds"
import { takeRecordingScreenshot as takeElectronRecordingScreenshot } from "./recording-screenshot"
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
let recordingStartSoundSuppressionDepth = 0

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
    await configureSidecarClient(client)
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

export async function configureRecordingBackend(): Promise<RecordingStatus> {
  const client = getSidecarClient()
  if (!client) {
    const status = unavailableRecordingStatus()
    emitRecordingStatusEvent(status)
    return status
  }
  try {
    const status = await configureSidecarClient(client)
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
    await configureSidecarClient(client)
    const result = await client.request<RecordingActionResult>(method, params)
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

async function configureSidecarClient(
  client: RecordingSidecarClient,
): Promise<RecordingStatus> {
  const suppressStartSound = lastRecordingStatus?.replayActive === true
  if (suppressStartSound) recordingStartSoundSuppressionDepth += 1
  try {
    return await client.configure(currentSidecarConfig())
  } finally {
    if (suppressStartSound) recordingStartSoundSuppressionDepth -= 1
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
  if (event.type === "game-ended") {
    lastRecordingStartSoundKey = null
  }
  maybePlayRecordingStartedSound(event)
  if (event.type === "capture-ready") {
    maybePlayClipSavedSound(event.capture)
  }
}

function maybePlayRecordingStartedSound(event: RecordingEvent): void {
  if (event.type !== "recording-started") return

  const soundKey = recordingStartSoundKey(event.status)
  if (!soundKey) return
  if (lastRecordingStartSoundKey === soundKey) return
  lastRecordingStartSoundKey = soundKey
  if (recordingStartSoundSuppressionDepth > 0) return

  playNotificationSound("recordingStarted")
}

function recordingStartSoundKey(status: RecordingStatus): string | null {
  if (status.backend !== "ready" || !status.replayActive) return null

  const targetKey = recordingTargetKey(status)
  return targetKey ? `replay:${targetKey}` : null
}

function recordingTargetKey(status: RecordingStatus): string | null {
  if (status.captureMode === "display") {
    return status.activeDisplay
      ? ["display", status.activeDisplay.id].join(":")
      : null
  }

  const game = status.activeGameDetail
  if (!game && !status.activeGame) return null

  const stableGameId =
    game?.id ??
    game?.executable ??
    game?.path ??
    game?.windowClass ??
    status.activeGame ??
    game?.name

  return [
    "game",
    stableGameId,
    game?.executable ?? "",
    game?.path ?? "",
    game?.windowClass ?? "",
    game?.name ?? status.activeGame ?? "",
  ].join(":")
}

function errorRecordingStatus(message: string): RecordingStatus {
  return unavailableRecordingStatus(message, "error")
}

function maybePlayClipSavedSound(capture: RecordingCapture): void {
  if (capture.kind !== "replay") return

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

  playNotificationSound("clipSaved")
}

function playNotificationSound(sound: RecordingNotificationSoundEvent): void {
  const sounds = getRecordingSettings().notificationSounds
  void playRecordingNotificationSound(sound, sounds[sound])
}

function canReplayBufferSaveFromStatus(
  status: RecordingStatus | null,
): boolean {
  return (
    status?.backend === "ready" &&
    status.replayActive &&
    status.runState !== "error"
  )
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
