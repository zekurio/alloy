import { t } from "@alloy/i18n"
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron"

const CONFIRMATION_RATE_WINDOW_MS = 60_000
const CONFIRMATION_RATE_LIMIT = 10
const confirmationTimes: number[] = []
let confirmationOpen = false

export interface NativeConfirmation {
  title: string
  message: string
  confirmLabel: string
  type?: "question" | "warning"
}

/** Require a real OS dialog before a renderer can trigger a sensitive action. */
export async function confirmNativeAction(
  event: IpcMainInvokeEvent,
  confirmation: NativeConfirmation,
): Promise<boolean> {
  const parent = BrowserWindow.fromWebContents(event.sender)
  if (!parent || confirmationOpen || !takeConfirmationSlot()) return false

  confirmationOpen = true
  try {
    const result = await dialog.showMessageBox(parent, {
      type: confirmation.type ?? "warning",
      title: t("Alloy"),
      message: confirmation.title,
      detail: confirmation.message,
      buttons: [t("Cancel"), confirmation.confirmLabel],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    return result.response === 1
  } finally {
    confirmationOpen = false
  }
}

function takeConfirmationSlot(now = Date.now()): boolean {
  while (
    confirmationTimes[0] !== undefined &&
    confirmationTimes[0] <= now - CONFIRMATION_RATE_WINDOW_MS
  ) {
    confirmationTimes.shift()
  }
  if (confirmationTimes.length >= CONFIRMATION_RATE_LIMIT) return false
  confirmationTimes.push(now)
  return true
}
