import type { DesktopNotificationInput } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { Notification } from "electron"

import { StrictStringSchema, type UntrustedInput } from "./runtime-validation"
import type { Windows } from "./windows"

const DesktopNotificationInputSchema = t.object({
  title: StrictStringSchema,
  body: StrictStringSchema,
  targetPath: StrictStringSchema.refine((path) => path.startsWith("/")),
})

export function showDesktopNotification(
  windows: Windows,
  input: UntrustedInput,
): void {
  const notification = desktopNotificationInput(input)
  if (!Notification.isSupported()) return
  const toast = new Notification({
    title: notification.title,
    body: notification.body,
  })
  toast.on("click", () => {
    windows.showAndNavigate(notification.targetPath)
  })
  toast.show()
}

function desktopNotificationInput(
  input: UntrustedInput,
): DesktopNotificationInput {
  const result = DesktopNotificationInputSchema.safeParse(input)
  if (!result.success) throw new Error("Invalid notification input")
  return result.data
}
