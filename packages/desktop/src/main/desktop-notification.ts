import { Notification } from "electron"

import type { DesktopNotificationInput } from "@/shared/ipc"

import type { Windows } from "./windows"

export function showDesktopNotification(
  windows: Windows,
  input: unknown,
): void {
  const notification = desktopNotificationInput(input)
  if (!Notification.isSupported()) return
  const toast = new Notification({
    title: notification.title,
    body: notification.body,
  })
  toast.on("click", () => {
    windows.showPrimary()
    windows.showAndNavigate(notification.targetPath)
  })
  toast.show()
}

function desktopNotificationInput(input: unknown): DesktopNotificationInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid notification input")
  }
  const value = input as Record<string, unknown>
  if (
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    typeof value.targetPath !== "string" ||
    !value.targetPath.startsWith("/")
  ) {
    throw new Error("Invalid notification input")
  }
  return {
    title: value.title,
    body: value.body,
    targetPath: value.targetPath,
  }
}
