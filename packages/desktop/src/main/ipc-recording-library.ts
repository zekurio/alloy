import { t } from "@alloy/i18n"
import { BrowserWindow, dialog } from "electron"

import type { BridgeHandlerFragment } from "./ipc-bridge"
import { requireMainSender } from "./ipc-guards"
import {
  normalizeLibraryCommitStagedImportRequest,
  normalizeLibraryDownloadRequest,
  normalizeLibraryExportRequest,
  normalizeLibraryMetaPatch,
  normalizeLibraryThumbnailSaveRequest,
} from "./ipc-normalizers"
import {
  deleteRecordingLibraryItem,
  commitRecordingLibraryStagedImport,
  discardRecordingLibraryStagedImport,
  exportRecordingLibraryItem,
  getRecordingLibrarySnapshot,
  revealRecordingLibraryItem,
  stageRecordingLibraryVideoFiles,
  updateRecordingLibraryCaptureMeta,
} from "./recording-library"
import {
  cancelRecordingLibraryClipDownload,
  listRecordingLibraryClipDownloads,
  startRecordingLibraryClipDownload,
} from "./recording-library-download"
import { VIDEO_EXTENSIONS } from "./recording-library-shared"
import { sameOrigin } from "./url-policy"

/** Capture-library bridge handlers; every channel is main-app-only. */
export const recordingLibraryBridgeHandlers = {
  "recording.getLibrary": {
    guard: requireMainSender,
    handle: () => getRecordingLibrarySnapshot(),
  },
  "recording.revealLibraryCapture": {
    guard: requireMainSender,
    handle: (_windows, _event, id: unknown) => {
      if (typeof id === "string") revealRecordingLibraryItem(id)
    },
  },
  "recording.exportLibraryCapture": {
    guard: requireMainSender,
    handle: (_windows, _event, request: unknown) =>
      exportRecordingLibraryItem(normalizeLibraryExportRequest(request)),
  },
  "recording.updateLibraryCapture": {
    guard: requireMainSender,
    handle: (_windows, _event, request: unknown) => {
      const patch = normalizeLibraryMetaPatch(request)
      if (!patch) throw new Error("Invalid capture metadata request.")
      return updateRecordingLibraryCaptureMeta(patch)
    },
  },
  "recording.deleteLibraryCapture": {
    guard: requireMainSender,
    handle: (_windows, _event, id: unknown) => {
      if (typeof id === "string") return deleteRecordingLibraryItem(id)
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
    handle: (_windows, _event, request: unknown) => {
      const normalized = normalizeLibraryCommitStagedImportRequest(request)
      if (!normalized) throw new Error("Invalid staged import request.")
      return commitRecordingLibraryStagedImport(normalized)
    },
  },
  "recording.discardStagedLibraryImport": {
    guard: requireMainSender,
    handle: (_windows, _event, id: unknown) => {
      if (typeof id === "string") {
        return discardRecordingLibraryStagedImport(id)
      }
    },
  },
  "recording.saveLibraryCaptureThumbnail": {
    guard: requireMainSender,
    handle: async (_windows, _event, id: unknown, data: unknown) => {
      const normalized = normalizeLibraryThumbnailSaveRequest(id, data)
      if (!normalized) throw new Error("Invalid thumbnail save request.")
      // Lazy import: keeps the image/blurhash pipeline off the startup path
      // until the first thumbnail is actually saved.
      const { storeRecordingThumbnail } =
        await import("./recording-library-thumbnails")
      storeRecordingThumbnail(normalized.id, normalized.data)
    },
  },
  "recording.downloadClip": {
    guard: requireMainSender,
    handle: (windows, _event, request: unknown) => {
      const normalized = normalizeLibraryDownloadRequest(request)
      if (!normalized) throw new Error("Invalid clip download request.")
      const serverUrl = windows.currentServerUrl()
      if (!serverUrl || !sameOrigin(normalized.mediaUrl, serverUrl)) {
        throw new Error("Clip downloads must come from the connected server.")
      }
      return startRecordingLibraryClipDownload(normalized)
    },
  },
  "recording.cancelClipDownload": {
    guard: requireMainSender,
    handle: (_windows, _event, clipId: unknown) => {
      if (typeof clipId === "string") {
        cancelRecordingLibraryClipDownload(clipId)
      }
    },
  },
  "recording.listClipDownloads": {
    guard: requireMainSender,
    handle: () => listRecordingLibraryClipDownloads(),
  },
} satisfies BridgeHandlerFragment
