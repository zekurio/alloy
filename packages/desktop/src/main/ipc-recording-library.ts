import { t } from "@alloy/i18n"
import { BrowserWindow, dialog } from "electron"

import type { DesktopApiHandlerFragment } from "./ipc-api"
import { requireMainSender } from "./ipc-guards"
import {
  normalizeLibraryCommitStagedImportRequest,
  normalizeLibraryDownloadRequest,
  normalizeLibraryExportRequest,
  normalizeLibraryMetaPatch,
  normalizeLibraryThumbnailSaveRequest,
  normalizeLibraryTrimUpdate,
} from "./ipc-normalizers"
import {
  commitRecordingLibraryStagedImport,
  deleteRecordingLibraryItem,
  discardRecordingLibraryStagedImport,
  exportRecordingLibraryItem,
  getRecordingLibrarySnapshot,
  revealRecordingLibraryItem,
  setRecordingLibraryCaptureTrim,
  stageRecordingLibraryVideoFiles,
  updateRecordingLibraryCaptureMeta,
} from "./recording-library"
import {
  cancelRecordingLibraryClipDownload,
  listRecordingLibraryClipDownloads,
  startRecordingLibraryClipDownload,
} from "./recording-library-download"
import { selectedServerClipDownloadUrl } from "./recording-library-download-policy"
import { VIDEO_EXTENSIONS } from "./recording-library-shared"
import {
  parseNonnegativeInteger,
  parseString,
  type UntrustedInput,
} from "./runtime-validation"

/** Capture-library native handlers; every channel is main-app-only. */
export const recordingLibraryDesktopApiHandlers = {
  "recording.getLibrary": {
    guard: requireMainSender,
    handle: () => getRecordingLibrarySnapshot(),
  },
  "recording.revealLibraryCapture": {
    guard: requireMainSender,
    handle: (_windows, _event, input: UntrustedInput) => {
      const id = parseString(input)
      if (id !== null) revealRecordingLibraryItem(id)
    },
  },
  "recording.exportLibraryCapture": {
    guard: requireMainSender,
    handle: (_windows, _event, request: UntrustedInput) =>
      exportRecordingLibraryItem(normalizeLibraryExportRequest(request)),
  },
  "recording.updateLibraryCapture": {
    guard: requireMainSender,
    handle: (_windows, _event, request: UntrustedInput) => {
      const patch = normalizeLibraryMetaPatch(request)
      if (!patch) throw new Error("Invalid capture metadata request.")
      return updateRecordingLibraryCaptureMeta(patch)
    },
  },
  "recording.setLibraryCaptureTrim": {
    guard: requireMainSender,
    handle: (_windows, _event, request: UntrustedInput) => {
      const update = normalizeLibraryTrimUpdate(request)
      if (!update) throw new Error("Invalid trim request.")
      return setRecordingLibraryCaptureTrim(update)
    },
  },
  "recording.deleteLibraryCapture": {
    guard: requireMainSender,
    handle: (_windows, _event, input: UntrustedInput) => {
      const id = parseString(input)
      if (id === null) return
      return deleteRecordingLibraryItem(id)
    },
  },
  "recording.importLibraryFiles": {
    guard: requireMainSender,
    handle: async (_windows, event) => {
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: t("Import clips"),
        filters: [
          {
            name: "Videos",
            extensions: [...VIDEO_EXTENSIONS].map((ext) => ext.slice(1)),
          },
        ],
        properties: ["openFile"],
      }
      const result = await (parent
        ? dialog.showOpenDialog(parent, options)
        : dialog.showOpenDialog(options))
      if (result.canceled || result.filePaths.length === 0) {
        return { staged: [], failed: [], canceled: true }
      }
      return stageRecordingLibraryVideoFiles(result.filePaths)
    },
  },
  "recording.commitStagedLibraryImport": {
    guard: requireMainSender,
    handle: (_windows, _event, request: UntrustedInput) => {
      const normalized = normalizeLibraryCommitStagedImportRequest(request)
      if (!normalized) throw new Error("Invalid staged import request.")
      return commitRecordingLibraryStagedImport(normalized)
    },
  },
  "recording.discardStagedLibraryImport": {
    guard: requireMainSender,
    handle: (_windows, _event, input: UntrustedInput) => {
      const id = parseString(input)
      if (id !== null) return discardRecordingLibraryStagedImport(id)
    },
  },
  "recording.saveLibraryCaptureThumbnail": {
    guard: requireMainSender,
    handle: async (
      _windows,
      _event,
      id: UntrustedInput,
      data: UntrustedInput,
    ) => {
      const normalized = normalizeLibraryThumbnailSaveRequest(id, data)
      if (!normalized) throw new Error("Invalid thumbnail save request.")
      // Lazy import: keeps the image/blurhash pipeline off the startup path
      // until the first thumbnail is actually saved.
      const { storeRecordingThumbnail } =
        await import("./recording-library-thumbnails")
      storeRecordingThumbnail(normalized.id, normalized.data)
    },
  },
  "recording.getLibraryCaptureAudioTrackUrl": {
    guard: requireMainSender,
    handle: async (
      _windows,
      _event,
      rawId: UntrustedInput,
      rawIndex: UntrustedInput,
    ) => {
      const id = parseString(rawId)
      const index = parseNonnegativeInteger(rawIndex)
      if (id === null || index === null) return null
      const { recordingCaptureAudioTrackUrl } =
        await import("./recording-library-audio-tracks")
      return recordingCaptureAudioTrackUrl(id, index)
    },
  },
  "recording.downloadClip": {
    guard: requireMainSender,
    handle: (windows, _event, request: UntrustedInput) => {
      const normalized = normalizeLibraryDownloadRequest(request)
      if (!normalized) throw new Error("Invalid clip download request.")
      const serverUrl = windows.currentServerUrl()
      if (!serverUrl) throw new Error("No Alloy server is connected.")
      const mediaUrl = selectedServerClipDownloadUrl(
        normalized.clipId,
        serverUrl,
      )
      if (!mediaUrl) throw new Error("Invalid clip download target.")
      return startRecordingLibraryClipDownload(normalized, mediaUrl)
    },
  },
  "recording.cancelClipDownload": {
    guard: requireMainSender,
    handle: (_windows, _event, input: UntrustedInput) => {
      const clipId = parseString(input)
      if (clipId !== null) cancelRecordingLibraryClipDownload(clipId)
    },
  },
  "recording.listClipDownloads": {
    guard: requireMainSender,
    handle: () => listRecordingLibraryClipDownloads(),
  },
} satisfies DesktopApiHandlerFragment
