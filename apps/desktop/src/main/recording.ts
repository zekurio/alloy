import {
  existsSync,
  mkdirSync,
  readdirSync,
  statfsSync,
  statSync,
} from "node:fs"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path"

import type {
  RecordingActionResult,
  RecordingEvent,
  RecordingStatus,
  RecordingStorageInfo,
} from "alloy-contracts"
import { logger } from "alloy-logging"
import { app } from "electron"

import { showRecordingHud } from "./recording-hud"
import {
  RecordingSidecarClient,
  type SidecarConfig,
} from "./recording-sidecar-client"
import { getRecordingSettings } from "./server-store"

const SIDECAR_MISSING =
  "Recording capture sidecar is not built yet. Run pnpm --dir apps/desktop build:sidecar."
const GB = 1_000_000_000

type RecordingEventListener = (event: RecordingEvent) => void

const recordingEventListeners = new Set<RecordingEventListener>()
let sidecarClient: RecordingSidecarClient | null = null

/** Default capture folder when the user hasn't picked one. */
export function defaultOutputFolder(): string {
  return join(app.getPath("videos"), "Alloy")
}

export function defaultReplayScratchFolder(): string {
  return join(app.getPath("temp"), "Alloy", "replay-buffer")
}

export async function getRecordingStatus(): Promise<RecordingStatus> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingStatus()

  try {
    await client.configure(currentSidecarConfig())
    return await client.request<RecordingStatus>("status")
  } catch (cause) {
    return errorRecordingStatus(errorText(cause, "Recording sidecar failed."))
  }
}

export async function getRecordingStorageInfo(): Promise<RecordingStorageInfo> {
  const outputFolder = currentOutputFolder()
  ensureFolder(outputFolder)

  const fsInfo = readFilesystemInfo(outputFolder)
  const clipsBytes = sumCaptureBytes(outputFolder)
  return {
    outputFolder,
    totalBytes: fsInfo.totalBytes,
    usedBytes: Math.max(0, fsInfo.totalBytes - fsInfo.availableBytes),
    availableBytes: fsInfo.availableBytes,
    clipsBytes,
  }
}

export function onRecordingEvent(listener: RecordingEventListener): () => void {
  recordingEventListeners.add(listener)
  return () => recordingEventListeners.delete(listener)
}

export async function configureRecordingBackend(): Promise<RecordingStatus> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingStatus()
  try {
    return await client.configure(currentSidecarConfig())
  } catch (cause) {
    return errorRecordingStatus(errorText(cause, "Recording sidecar failed."))
  }
}

export async function saveReplayClip(): Promise<RecordingActionResult> {
  const status = await getRecordingStatus()
  const showHud = shouldShowSaveHud(status)

  if (showHud) {
    showRecordingHud({ kind: "saving", title: "Saving clip..." })
  }

  const result = await runRecordingAction("saveReplayClip")
  if (showHud) {
    showRecordingHud(
      result.ok
        ? { kind: "saved", title: "Clip saved" }
        : {
            kind: "error",
            title: "Couldn't save clip",
            detail: result.error,
          },
    )
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

export function resolveRevealableCapturePath(filename: string): string | null {
  if (!/\.(mp4|mkv|mov|webm)$/i.test(filename)) return null

  const outputFolder = resolve(currentOutputFolder())
  const capturePath = resolve(filename)
  const relativePath = relative(outputFolder, capturePath)
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    return null
  }
  return capturePath
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
  return {
    ok: false,
    error: message,
    status: unavailableRecordingStatus(message),
  }
}

async function runRecordingAction(
  method: "saveReplayClip" | "stopRecording",
): Promise<RecordingActionResult> {
  const client = getSidecarClient()
  if (!client) return unavailableRecordingAction()

  try {
    await client.configure(currentSidecarConfig())
    return await client.request<RecordingActionResult>(method)
  } catch (cause) {
    const message = errorText(cause, "Recording sidecar failed.")
    return {
      ok: false,
      error: message,
      status: errorRecordingStatus(message),
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

function currentOutputFolder(): string {
  return getRecordingSettings().outputFolder || defaultOutputFolder()
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
  return join(app.getAppPath(), "resources", "sidecar", executable)
}

function obsRuntimeDir(): string | null {
  const configured = process.env.ALLOY_OBS_RUNTIME_DIR
  const configuredRuntime = configured
    ? normalizeObsRuntimeDir(configured)
    : null
  if (configuredRuntime) return configuredRuntime

  const bundled = app.isPackaged
    ? join(process.resourcesPath, "obs-runtime")
    : join(app.getAppPath(), "resources", "obs-runtime")
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
  const libraries =
    process.platform === "win32"
      ? ["obs.dll"]
      : process.platform === "darwin"
        ? ["libobs.0.dylib", "libobs.dylib"]
        : ["libobs.so.0", "libobs.so"]
  return libraries.some((library) => existsSync(join(candidate, library)))
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
  for (const listener of recordingEventListeners) {
    listener(event)
  }
}

function errorRecordingStatus(message: string): RecordingStatus {
  return unavailableRecordingStatus(message, "error")
}

function ensureFolder(path: string) {
  try {
    mkdirSync(path, { recursive: true })
  } catch (cause) {
    logger.warn("[desktop] failed to create capture folder:", cause)
  }
}

function readFilesystemInfo(path: string): {
  totalBytes: number
  availableBytes: number
} {
  try {
    const info = statfsSync(path)
    return {
      totalBytes: Number(info.blocks) * Number(info.bsize),
      availableBytes: Number(info.bavail) * Number(info.bsize),
    }
  } catch {
    return {
      totalBytes: 2_000 * GB,
      availableBytes: 0,
    }
  }
}

function sumCaptureBytes(path: string): number {
  try {
    return readdirSync(path).reduce((total, entry) => {
      const entryPath = join(path, entry)
      const stat = statSync(entryPath)
      if (stat.isDirectory()) return total + sumCaptureBytes(entryPath)
      return stat.isFile() && /\.(mp4|mkv|mov|webm)$/i.test(entry)
        ? total + stat.size
        : total
    }, 0)
  } catch {
    return 0
  }
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function shouldShowSaveHud(status: RecordingStatus): boolean {
  return (
    status.backend === "ready" &&
    status.mode === "replay-buffer" &&
    status.activeGameDetail !== null
  )
}
