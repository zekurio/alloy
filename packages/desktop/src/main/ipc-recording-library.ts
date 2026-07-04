import { t } from "@alloy/i18n"
import { BrowserWindow, dialog, ipcMain } from "electron"

import { IPC } from "@/shared/ipc"

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
  openRecordingLibraryFolder,
  openRecordingLibraryItem,
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
import type { Windows } from "./windows"

export function registerRecordingLibraryIpc(windows: Windows): void {
  registerRecordingLibraryReadIpc(windows)
  registerRecordingLibraryWriteIpc(windows)
  registerRecordingLibraryImportIpc(windows)
  registerRecordingLibraryDownloadIpc(windows)
}

function registerRecordingLibraryReadIpc(windows: Windows): void {
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
}

function registerRecordingLibraryWriteIpc(windows: Windows): void {
  ipcMain.handle(
    IPC.exportRecordingLibraryCapture,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      return exportRecordingLibraryItem(normalizeLibraryExportRequest(request))
    },
  )
  ipcMain.handle(
    IPC.updateRecordingLibraryCapture,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const patch = normalizeLibraryMetaPatch(request)
      if (!patch) throw new Error("Invalid capture metadata request.")
      return updateRecordingLibraryCaptureMeta(patch)
    },
  )
  ipcMain.handle(IPC.deleteRecordingLibraryCapture, (event, id: unknown) => {
    requireMainSender(windows, event)
    if (typeof id === "string") return deleteRecordingLibraryItem(id)
  })
}

function registerRecordingLibraryImportIpc(windows: Windows): void {
  ipcMain.handle(IPC.importRecordingLibraryFiles, async (event) => {
    requireMainSender(windows, event)
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
  })
  ipcMain.handle(
    IPC.commitRecordingLibraryStagedImport,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const normalized = normalizeLibraryCommitStagedImportRequest(request)
      if (!normalized) throw new Error("Invalid staged import request.")
      return commitRecordingLibraryStagedImport(normalized)
    },
  )
  ipcMain.handle(
    IPC.discardRecordingLibraryStagedImport,
    (event, id: unknown) => {
      requireMainSender(windows, event)
      if (typeof id === "string") {
        return discardRecordingLibraryStagedImport(id)
      }
    },
  )
  ipcMain.handle(
    IPC.saveRecordingLibraryCaptureThumbnail,
    async (event, request: unknown) => {
      requireMainSender(windows, event)
      const normalized = normalizeLibraryThumbnailSaveRequest(request)
      if (!normalized) throw new Error("Invalid thumbnail save request.")
      const { storeRecordingThumbnail } =
        await import("./recording-library-thumbnails")
      storeRecordingThumbnail(normalized.id, normalized.data)
    },
  )
}

function registerRecordingLibraryDownloadIpc(windows: Windows): void {
  ipcMain.handle(
    IPC.downloadRecordingLibraryClip,
    (event, request: unknown) => {
      requireMainSender(windows, event)
      const normalized = normalizeLibraryDownloadRequest(request)
      if (!normalized) throw new Error("Invalid clip download request.")
      const serverUrl = windows.currentServerUrl()
      if (!serverUrl || !sameOrigin(normalized.mediaUrl, serverUrl)) {
        throw new Error("Clip downloads must come from the connected server.")
      }
      return startRecordingLibraryClipDownload(normalized)
    },
  )
  ipcMain.handle(
    IPC.cancelRecordingLibraryClipDownload,
    (event, clipId: unknown) => {
      requireMainSender(windows, event)
      if (typeof clipId === "string") {
        cancelRecordingLibraryClipDownload(clipId)
      }
    },
  )
  ipcMain.handle(IPC.listRecordingLibraryClipDownloads, (event) => {
    requireMainSender(windows, event)
    return listRecordingLibraryClipDownloads()
  })
}
