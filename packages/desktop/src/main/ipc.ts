import {
  CLIP_PRIVACY,
  normalizeRecordingSettings,
  RECORDING_NOTIFICATION_SOUND_EVENTS,
  type ClipPrivacy,
  type RecordingNotificationSoundEvent,
} from "alloy-contracts"
import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron"

import type {
  ConnectResult,
  ProbeResult,
  RecordingCaptureMention,
  RecordingLibraryExportRequest,
  RecordingLibraryExportSegment,
  RecordingLibraryImportRequest,
  RecordingLibraryMetaPatch,
  RecordingLibraryProject,
  RecordingLibraryProjectClip,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectTrack,
  RecordingLibraryProjectTransition,
} from "../shared/ipc"
import { IPC } from "../shared/ipc"
import { loginViaBrowser } from "./browser-login"
import { probeServer } from "./probe"
import {
  configureRecordingBackend,
  emitRecordingSettingsEvent,
  getRecordingStatus,
  getRecordingStorageInfo,
  addRecordingBookmark,
  listGameProcesses,
  listRecordingDisplays,
  onRecordingEvent,
  resolveRevealableCapturePath,
  saveReplayClip,
  stopRecording,
  takeRecordingScreenshot,
  toggleLongRecording,
} from "./recording"
import { configureRecordingHotkeys } from "./recording-hotkeys"
import {
  deleteRecordingLibraryItem,
  getRecordingLibrarySnapshot,
  getRecordingLibraryCaptureKeyframes,
  exportRecordingLibraryItem,
  importRecordingLibraryCapture,
  openRecordingLibraryFolder,
  openRecordingLibraryItem,
  revealRecordingLibraryItem,
  deleteRecordingLibraryProjectDraft,
  saveRecordingLibraryProjectDraft,
  updateRecordingLibraryCaptureMeta,
} from "./recording-library"
import {
  ensureNotificationSoundsDir,
  listNotificationSoundLibrary,
} from "./recording-notification-sounds"
import {
  forgetServer,
  getRecordingSettings,
  getSavedServers,
  getStartupServerUrl,
  rememberServer,
  saveRecordingSettings,
} from "./server-store"
import { clearRemoteWebCache, hasValidSession } from "./session"
import type { Windows } from "./windows"

const SETUP_REQUIRED_ERROR =
  "This Alloy server needs setup. Finish setup in your browser, then connect again."

/**
 * Register the overlay's privileged IPC surface. Handlers are intentionally
 * thin: validate input, mutate persisted state, drive the windows. All channels
 * are request/response (`handle`) so the overlay gets typed results back.
 */
export function registerIpc(windows: Windows): void {
  registerRecordingEvents()
  registerServerIpc(windows)
  registerRecordingIpc(windows)
}

function registerRecordingEvents(): void {
  onRecordingEvent((recordingEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC.recordingEvent, recordingEvent)
      }
    }
  })
}

function registerServerIpc(windows: Windows): void {
  ipcMain.handle(IPC.probe, (event, url: unknown): Promise<ProbeResult> => {
    requireOverlaySender(windows, event)
    if (typeof url !== "string") {
      return Promise.resolve({ ok: false, error: "Enter a server URL." })
    }
    return probeServer(url)
  })

  ipcMain.handle(
    IPC.connect,
    async (event, url: unknown): Promise<ConnectResult> => {
      requireDesktopSender(windows, event)
      if (typeof url !== "string") {
        return { ok: false, error: "Enter a server URL." }
      }
      // Re-probe before committing so we only ever persist + load a URL we just
      // confirmed is a reachable Alloy server.
      const result = await probeServer(url)
      if (!result.ok) return { ok: false, error: result.error }
      if (result.config.setupRequired) {
        await shell
          .openExternal(new URL("/setup", result.serverUrl).toString())
          .catch(() => undefined)
        return { ok: false, error: SETUP_REQUIRED_ERROR }
      }

      // Electron can't run passkeys/embedded OAuth, so unless a stored session
      // is still valid we authenticate in the system browser and inject the
      // resulting session before loading the app.
      if (!(await hasValidSession(result.serverUrl))) {
        const login = await loginViaBrowser(result.serverUrl)
        if (!login.ok) return { ok: false, error: login.error }
      }

      rememberServer(result.serverUrl)
      await clearRemoteWebCache()
      windows.connectTo(result.serverUrl)
      return { ok: true, serverUrl: result.serverUrl }
    },
  )
  ipcMain.handle(IPC.openConnect, (event) => {
    requireDesktopSender(windows, event)
    windows.openConnect()
  })
  ipcMain.handle(IPC.openLibrary, (event) => {
    requireMainSender(windows, event)
    windows.openLibrary()
  })

  ipcMain.handle(IPC.getStartupServer, (event): string | null => {
    requireOverlaySender(windows, event)
    return getStartupServerUrl()
  })
  ipcMain.handle(IPC.getServers, (event) => {
    requireDesktopServerStateSender(windows, event)
    return getSavedServers()
  })
  ipcMain.handle(IPC.getCurrentServer, (event) => {
    requireDesktopServerStateSender(windows, event)
    return windows.currentServerUrl()
  })
  ipcMain.handle(IPC.forgetServer, (event, url: unknown) => {
    requireDesktopSender(windows, event)
    if (typeof url !== "string") return getSavedServers()
    return forgetServer(url)
  })
  ipcMain.handle(IPC.openSettings, (event) => {
    requireDesktopSender(windows, event)
    windows.openSettings()
  })
  ipcMain.handle(IPC.minimizeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    window.minimize()
  })
  ipcMain.handle(IPC.toggleMaximizeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  })
  ipcMain.handle(IPC.closeWindow, (event) => {
    const window = requireControllableWindow(windows, event)
    window.close()
  })
}

function registerRecordingIpc(windows: Windows): void {
  registerRecordingSettingsIpc(windows)
  registerRecordingStorageIpc(windows)
  registerRecordingLibraryIpc(windows)
  registerRecordingSoundIpc(windows)
  registerRecordingSourceIpc(windows)
  registerRecordingActionIpc(windows)
}

function registerRecordingSettingsIpc(windows: Windows): void {
  ipcMain.handle(IPC.getRecordingSettings, (event) => {
    requireMainSender(windows, event)
    return getRecordingSettings()
  })
  ipcMain.handle(IPC.setRecordingSettings, async (event, settings: unknown) => {
    requireMainSender(windows, event)
    const saved = saveRecordingSettings(normalizeRecordingSettings(settings))
    emitRecordingSettingsEvent()
    void configureRecordingBackend()
    configureRecordingHotkeys(saved)
    return saved
  })
  ipcMain.handle(IPC.getRecordingStatus, (event) => {
    requireMainSender(windows, event)
    return getRecordingStatus()
  })
}

function registerRecordingStorageIpc(windows: Windows): void {
  ipcMain.handle(IPC.getRecordingStorageInfo, (event) => {
    requireMainSender(windows, event)
    return getRecordingStorageInfo()
  })
  ipcMain.handle(
    IPC.selectOutputFolder,
    async (event): Promise<string | null> => {
      requireMainSender(windows, event)
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: "Choose capture folder",
        properties: ["openDirectory", "createDirectory"],
      }
      const result = await (parent
        ? dialog.showOpenDialog(parent, options)
        : dialog.showOpenDialog(options))
      const folder = result.filePaths[0]
      if (result.canceled || !folder) return null

      const current = getRecordingSettings()
      const saved = saveRecordingSettings(
        normalizeRecordingSettings({ ...current, outputFolder: folder }),
      )
      emitRecordingSettingsEvent()
      void configureRecordingBackend()
      configureRecordingHotkeys(saved)
      return folder
    },
  )
}

function registerRecordingLibraryIpc(windows: Windows): void {
  ipcMain.handle(IPC.getRecordingLibrary, (event) => {
    requireMainSender(windows, event)
    return getRecordingLibrarySnapshot()
  })
  ipcMain.handle(IPC.openRecordingLibraryFolder, (event) => {
    requireMainSender(windows, event)
    openRecordingLibraryFolder()
  })
  ipcMain.handle(IPC.openRecordingLibraryCapture, (event, id: unknown) => {
    requireMainSender(windows, event)
    if (typeof id === "string") openRecordingLibraryItem(id)
  })
  ipcMain.handle(IPC.revealRecordingLibraryCapture, (event, id: unknown) => {
    requireMainSender(windows, event)
    if (typeof id === "string") revealRecordingLibraryItem(id)
  })
  ipcMain.handle(
    IPC.exportRecordingLibraryCapture,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      return exportRecordingLibraryItem(normalizeLibraryExportRequest(request))
    },
  )
  ipcMain.handle(
    IPC.getRecordingLibraryCaptureKeyframes,
    (event, id: unknown) => {
      requireMainSender(windows, event)
      return typeof id === "string"
        ? getRecordingLibraryCaptureKeyframes(id)
        : []
    },
  )
  ipcMain.handle(
    IPC.updateRecordingLibraryCapture,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const patch = normalizeLibraryMetaPatch(request)
      if (patch) updateRecordingLibraryCaptureMeta(patch)
    },
  )
  ipcMain.handle(
    IPC.saveRecordingLibraryProjectDraft,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const normalized = normalizeProjectDraftSaveRequest(request)
      if (!normalized) throw new Error("Invalid project draft request.")
      return saveRecordingLibraryProjectDraft(normalized)
    },
  )
  ipcMain.handle(
    IPC.deleteRecordingLibraryProjectDraft,
    (event, id: unknown) => {
      requireMainSender(windows, event)
      if (typeof id === "string") deleteRecordingLibraryProjectDraft(id)
    },
  )
  ipcMain.handle(IPC.deleteRecordingLibraryCapture, (event, id: unknown) => {
    requireMainSender(windows, event)
    if (typeof id === "string") return deleteRecordingLibraryItem(id)
  })
  ipcMain.handle(
    IPC.importRecordingLibraryCapture,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const normalized = normalizeLibraryImportRequest(request)
      if (!normalized) throw new Error("Invalid render import request.")
      return importRecordingLibraryCapture(normalized)
    },
  )
}

function registerRecordingSoundIpc(windows: Windows): void {
  ipcMain.handle(IPC.listNotificationSounds, (event) => {
    requireMainSender(windows, event)
    return listNotificationSoundLibrary()
  })
  ipcMain.handle(
    IPC.openNotificationSoundsFolder,
    async (event, sound: unknown): Promise<void> => {
      requireMainSender(windows, event)
      if (!isNotificationSoundEvent(sound)) return
      const openError = await shell.openPath(ensureNotificationSoundsDir(sound))
      if (openError) throw new Error(openError)
    },
  )
}

function registerRecordingSourceIpc(windows: Windows): void {
  ipcMain.handle(IPC.listGameProcesses, async (event) => {
    requireMainSender(windows, event)
    return listGameProcesses()
  })
  ipcMain.handle(IPC.listRecordingDisplays, async (event) => {
    requireMainSender(windows, event)
    return listRecordingDisplays()
  })
}

function registerRecordingActionIpc(windows: Windows): void {
  ipcMain.handle(IPC.saveReplayClip, (event, request: unknown) => {
    requireMainSender(windows, event)
    return saveReplayClip(normalizeSaveReplayClipRequest(request))
  })
  ipcMain.handle(IPC.addRecordingBookmark, (event, request: unknown) => {
    requireMainSender(windows, event)
    return addRecordingBookmark(normalizeActionRequest(request))
  })
  ipcMain.handle(IPC.takeRecordingScreenshot, (event, request: unknown) => {
    requireMainSender(windows, event)
    return takeRecordingScreenshot(normalizeActionRequest(request))
  })
  ipcMain.handle(IPC.toggleLongRecording, (event, request: unknown) => {
    requireMainSender(windows, event)
    return toggleLongRecording(normalizeActionRequest(request))
  })
  ipcMain.handle(IPC.stopRecording, (event) => {
    requireMainSender(windows, event)
    return stopRecording()
  })
  ipcMain.handle(IPC.revealRecordingCapture, (event, filename: unknown) => {
    requireMainSender(windows, event)
    if (typeof filename !== "string" || filename.length === 0) return
    const capturePath = resolveRevealableCapturePath(filename)
    if (capturePath) shell.showItemInFolder(capturePath)
  })
}

function requireOverlaySender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  if (!windows.canUseOverlayBridge(event.sender)) throw unauthorizedIpcError()
}

function requireMainSender(windows: Windows, event: IpcMainInvokeEvent): void {
  if (!windows.canUseAppBridge(event.sender, event.senderFrame?.url ?? "")) {
    throw unauthorizedIpcError()
  }
}

function requireDesktopSender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  if (
    !windows.canUseDesktopBridge(event.sender, event.senderFrame?.url ?? "")
  ) {
    throw unauthorizedIpcError()
  }
}

function requireDesktopServerStateSender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  if (
    !windows.canUseDesktopServerStateBridge(
      event.sender,
      event.senderFrame?.url ?? "",
    )
  ) {
    throw unauthorizedIpcError()
  }
}

function requireControllableWindow(
  windows: Windows,
  event: IpcMainInvokeEvent,
): BrowserWindow {
  requireMainSender(windows, event)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw unauthorizedIpcError()
  return window
}

function unauthorizedIpcError(): Error {
  return new Error("Unauthorized desktop IPC sender.")
}

function isNotificationSoundEvent(
  value: unknown,
): value is RecordingNotificationSoundEvent {
  return RECORDING_NOTIFICATION_SOUND_EVENTS.includes(
    value as RecordingNotificationSoundEvent,
  )
}

function normalizeActionRequest(value: unknown): { requestedAtUnixMs: number } {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  return {
    requestedAtUnixMs: normalizeUnixMs(record.requestedAtUnixMs),
  }
}

function normalizeSaveReplayClipRequest(value: unknown): {
  requestedAtUnixMs: number
  durationSeconds: number
} {
  const request = normalizeActionRequest(value)
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  return {
    ...request,
    durationSeconds: normalizeDurationSeconds(record.durationSeconds),
  }
}

const EXPORT_SEGMENTS_MAX = 100

function normalizeLibraryExportRequest(
  value: unknown,
): RecordingLibraryExportRequest {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {}
  const segments: RecordingLibraryExportSegment[] = (
    Array.isArray(record.segments) ? record.segments : []
  )
    .slice(0, EXPORT_SEGMENTS_MAX)
    .flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return []
      const segment = entry as Record<string, unknown>
      return [
        {
          startMs: normalizeTrimMs(segment.startMs),
          endMs: normalizeTrimMs(segment.endMs),
        },
      ]
    })
  return {
    id: typeof record.id === "string" ? record.id : "",
    segments,
  }
}

/** Hard cap on imported render size (a structured-clone copy in memory). */
const IMPORT_MAX_BYTES = 4 * 1024 * 1024 * 1024
const IMPORT_FILE_NAME_MAX = 120

function normalizeLibraryImportRequest(
  value: unknown,
): RecordingLibraryImportRequest | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (!(record.data instanceof Uint8Array)) return null
  if (
    record.data.byteLength === 0 ||
    record.data.byteLength > IMPORT_MAX_BYTES
  ) {
    return null
  }
  if (typeof record.fileName !== "string") return null
  const durationMs =
    typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? Math.max(0, record.durationMs)
      : 0
  return {
    fileName: record.fileName.slice(0, IMPORT_FILE_NAME_MAX),
    data: record.data,
    durationMs,
    width: normalizeDimension(record.width),
    height: normalizeDimension(record.height),
  }
}

const PROJECT_DRAFT_TITLE_MAX = 200
const PROJECT_DRAFT_ID_MAX = 120
const PROJECT_DRAFT_LABEL_MAX = 200
const PROJECT_DRAFT_TRACKS_MAX = 50
const PROJECT_DRAFT_CLIPS_MAX = 1000
const PROJECT_DRAFT_TRANSITIONS_MAX = 1000
const PROJECT_DRAFT_MAX_MS = 24 * 60 * 60 * 1000

function normalizeProjectDraftSaveRequest(
  value: unknown,
): RecordingLibraryProjectDraftSaveRequest | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const project = normalizeProjectDraftProject(record.project)
  if (!project) return null
  return {
    id:
      typeof record.id === "string" && record.id.length > 0
        ? record.id.slice(0, PROJECT_DRAFT_ID_MAX)
        : null,
    title:
      typeof record.title === "string"
        ? record.title.slice(0, PROJECT_DRAFT_TITLE_MAX)
        : "",
    project,
  }
}

function normalizeProjectDraftProject(
  value: unknown,
): RecordingLibraryProject | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const tracks = (Array.isArray(record.tracks) ? record.tracks : [])
    .slice(0, PROJECT_DRAFT_TRACKS_MAX)
    .map(normalizeProjectDraftTrack)
    .filter((track): track is RecordingLibraryProjectTrack => track !== null)
  if (tracks.length === 0) return null
  const trackIds = new Set(tracks.map((track) => track.id))
  const clips = (Array.isArray(record.clips) ? record.clips : [])
    .slice(0, PROJECT_DRAFT_CLIPS_MAX)
    .map((clip) => normalizeProjectDraftClip(clip, trackIds))
    .filter((clip): clip is RecordingLibraryProjectClip => clip !== null)
  const clipIds = new Set(clips.map((clip) => clip.id))
  const transitions = (
    Array.isArray(record.transitions) ? record.transitions : []
  )
    .slice(0, PROJECT_DRAFT_TRANSITIONS_MAX)
    .map((transition) => normalizeProjectDraftTransition(transition, clipIds))
    .filter(
      (transition): transition is RecordingLibraryProjectTransition =>
        transition !== null,
    )
  return { tracks, clips, transitions }
}

function normalizeProjectDraftTrack(
  value: unknown,
): RecordingLibraryProjectTrack | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const id = normalizeProjectDraftString(record.id, PROJECT_DRAFT_ID_MAX)
  if (!id) return null
  return {
    id,
    label:
      normalizeProjectDraftString(record.label, PROJECT_DRAFT_LABEL_MAX) ||
      "Track",
  }
}

function normalizeProjectDraftClip(
  value: unknown,
  trackIds: Set<string>,
): RecordingLibraryProjectClip | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const id = normalizeProjectDraftString(record.id, PROJECT_DRAFT_ID_MAX)
  const trackId = normalizeProjectDraftString(
    record.trackId,
    PROJECT_DRAFT_ID_MAX,
  )
  const sourceId = normalizeProjectDraftString(
    record.sourceId,
    PROJECT_DRAFT_ID_MAX,
  )
  if (!id || !trackId || !sourceId || !trackIds.has(trackId)) return null

  const sourceDurationMs = normalizeProjectDraftMs(record.sourceDurationMs)
  const sourceStartMs = Math.min(
    normalizeProjectDraftMs(record.sourceStartMs),
    sourceDurationMs,
  )
  const sourceEndMs = Math.max(
    sourceStartMs,
    Math.min(normalizeProjectDraftMs(record.sourceEndMs), sourceDurationMs),
  )
  return {
    id,
    trackId,
    sourceId,
    sourceDurationMs,
    sourceStartMs,
    sourceEndMs,
    startMs: normalizeProjectDraftMs(record.startMs),
    label:
      normalizeProjectDraftString(record.label, PROJECT_DRAFT_LABEL_MAX) ||
      "Clip",
  }
}

function normalizeProjectDraftTransition(
  value: unknown,
  clipIds: Set<string>,
): RecordingLibraryProjectTransition | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const id = normalizeProjectDraftString(record.id, PROJECT_DRAFT_ID_MAX)
  const leftClipId = normalizeProjectDraftString(
    record.leftClipId,
    PROJECT_DRAFT_ID_MAX,
  )
  const rightClipId = normalizeProjectDraftString(
    record.rightClipId,
    PROJECT_DRAFT_ID_MAX,
  )
  if (
    !id ||
    record.type !== "crossfade" ||
    !leftClipId ||
    !rightClipId ||
    !clipIds.has(leftClipId) ||
    !clipIds.has(rightClipId)
  ) {
    return null
  }
  return {
    id,
    type: "crossfade",
    leftClipId,
    rightClipId,
    durationMs: normalizeProjectDraftMs(record.durationMs),
  }
}

function normalizeProjectDraftString(
  value: unknown,
  maxLength: number,
): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function normalizeProjectDraftMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(PROJECT_DRAFT_MAX_MS, Math.max(0, Math.round(value)))
    : 0
}

function normalizeDimension(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null
}

const META_TITLE_MAX = 200
const META_DESCRIPTION_MAX = 4000
const META_TAGS_MAX = 500
const META_MENTIONS_MAX = 50

/**
 * Returns a sanitized draft-metadata patch, or null when the request carries
 * no usable id. Unknown fields are dropped; present fields are length-capped
 * so a misbehaving page can't bloat the manifest.
 */
function normalizeLibraryMetaPatch(
  value: unknown,
): RecordingLibraryMetaPatch | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || record.id.length === 0) return null

  const patch: RecordingLibraryMetaPatch = { id: record.id }
  if (typeof record.title === "string") {
    const title = record.title.trim().slice(0, META_TITLE_MAX)
    if (title.length > 0) patch.title = title
  }
  if (typeof record.description === "string" || record.description === null) {
    patch.description =
      record.description?.slice(0, META_DESCRIPTION_MAX) ?? null
  }
  if (typeof record.tags === "string" || record.tags === null) {
    patch.tags = record.tags?.slice(0, META_TAGS_MAX) ?? null
  }
  if (Array.isArray(record.mentions)) {
    patch.mentions = record.mentions
      .slice(0, META_MENTIONS_MAX)
      .map(normalizeCaptureMention)
      .filter((mention): mention is RecordingCaptureMention => mention !== null)
  }
  if (record.privacy === null) {
    patch.privacy = null
  } else if (CLIP_PRIVACY.includes(record.privacy as ClipPrivacy)) {
    patch.privacy = record.privacy as ClipPrivacy
  }
  return patch
}

function normalizeCaptureMention(
  value: unknown,
): RecordingCaptureMention | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || record.id.length === 0) return null
  return {
    id: record.id,
    username: typeof record.username === "string" ? record.username : "",
    displayUsername:
      typeof record.displayUsername === "string" ? record.displayUsername : "",
    image: typeof record.image === "string" ? record.image : null,
  }
}

function normalizeTrimMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0
}

function normalizeUnixMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : Date.now()
}

function normalizeDurationSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(600, Math.max(15, Math.round(value)))
    : 90
}
