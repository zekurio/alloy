import type { DesktopNotificationInput } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { Notification } from "electron"

import { StrictStringSchema, type UntrustedInput } from "./runtime-validation"
import type { Windows } from "./windows"

const DesktopNotificationInputSchema = t.object({
  title: StrictStringSchema.max(200),
  body: StrictStringSchema.max(1000),
  targetPath: StrictStringSchema.max(2048).refine(
    (path) => path.startsWith("/") && !path.startsWith("//"),
  ),
})
const NOTIFICATION_RATE_WINDOW_MS = 60_000
const NOTIFICATION_RATE_LIMIT = 10
const notificationTimes: number[] = []

export function showDesktopNotification(
  windows: Windows,
  input: UntrustedInput,
): void {
  const notification = desktopNotificationInput(input)
  if (!Notification.isSupported() || !takeNotificationSlot()) return
  const toast = new Notification({
    title: notification.title,
    body: notification.body,
  })
  toast.on("click", () => {
    windows.showAndNavigate(notification.targetPath)
  })
  toast.show()
}

function takeNotificationSlot(now = Date.now()): boolean {
  while (
    notificationTimes[0] !== undefined &&
    notificationTimes[0] <= now - NOTIFICATION_RATE_WINDOW_MS
  ) {
    notificationTimes.shift()
  }
  if (notificationTimes.length >= NOTIFICATION_RATE_LIMIT) return false
  notificationTimes.push(now)
  return true
}

function desktopNotificationInput(
  input: UntrustedInput,
): DesktopNotificationInput {
  const result = DesktopNotificationInputSchema.safeParse(input)
  if (!result.success) throw new Error("Invalid notification input")
  return result.data
}
