import { BrowserWindow, type IpcMainInvokeEvent } from "electron"

import type { Windows } from "./windows"

export function requireOverlaySender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  if (!windows.canUseOverlayBridge(event.sender)) throw unauthorizedIpcError()
}

export function requireMainSender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  if (!windows.canUseAppBridge(event.sender, event.senderFrame?.url ?? "")) {
    throw unauthorizedIpcError()
  }
}

export function requireDesktopSender(
  windows: Windows,
  event: IpcMainInvokeEvent,
): void {
  if (
    !windows.canUseDesktopBridge(event.sender, event.senderFrame?.url ?? "")
  ) {
    throw unauthorizedIpcError()
  }
}

export function requireDesktopServerStateSender(
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

export function requireControllableWindow(
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
