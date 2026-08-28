import { BrowserWindow, type IpcMainInvokeEvent } from "electron"

import type { Windows } from "./windows"

export function requireOverlaySender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  requireMainFrame(event)
  if (!windows.canUseOverlayApi(event.sender, event.senderFrame?.url ?? "")) {
    throw unauthorizedIpcError()
  }
}

export function requireMainSender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  requireMainFrame(event)
  if (!windows.canUseAppApi(event.sender, event.senderFrame?.url ?? "")) {
    throw unauthorizedIpcError()
  }
}

export function requireDesktopSender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  requireMainFrame(event)
  if (!windows.canUseDesktopApi(event.sender, event.senderFrame?.url ?? "")) {
    throw unauthorizedIpcError()
  }
}

export function requireDesktopServerStateSender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  requireMainFrame(event)
  if (
    !windows.canUseDesktopServerStateApi(
      event.sender,
      event.senderFrame?.url ?? "",
    )
  ) {
    throw unauthorizedIpcError()
  }
}

export function requireControllableWindow(
  windows: Windows,
  event: IpcMainInvokeEvent,
): BrowserWindow {
  requireMainSender(windows, event)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw unauthorizedIpcError()
  return window
}

function requireMainFrame(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw unauthorizedIpcError()
  }
}

function unauthorizedIpcError(): Error {
  return new Error("Unauthorized desktop IPC sender.")
}
