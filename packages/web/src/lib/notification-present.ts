import { clipThumbnailUrl, type NotificationItem } from "@alloy/api"

import { clientLogger } from "@/lib/client-log"

import { alloyDesktop } from "./desktop"
import { apiOrigin, publicOrigin } from "./env"
import { notificationDisplay } from "./notification-display"
import { userImageSrc } from "./user-display"

interface AlloyNotificationOptions extends NotificationOptions {
  image?: string
}

export type NotificationNavigator = (options: { to: string }) => void

export function presentNotification(
  item: NotificationItem,
  navigate: NotificationNavigator,
): void {
  if (document.visibilityState === "visible") return
  const display = notificationDisplay(item)
  const desktop = alloyDesktop()
  if (desktop) {
    void desktop.notifications
      .show({
        title: display.title,
        body: display.body,
        targetPath: display.targetPath,
      })
      .catch((cause) => {
        clientLogger.warn(
          `[notifications] Failed to show desktop notification ${item.id}.`,
          cause,
        )
      })
    return
  }
  if (!globalThis.Notification || Notification.permission !== "granted") {
    return
  }
  const options: AlloyNotificationOptions = {
    body: display.body,
    icon:
      userImageSrc(item.actor?.image) ??
      new URL("/logo.png", publicOrigin()).toString(),
    tag: item.id,
  }
  if (item.clip?.thumbVersion) {
    options.image = clipThumbnailUrl(
      item.clip.id,
      apiOrigin(),
      item.clip.thumbVersion,
    )
  }
  const notification = new Notification(display.title, options)
  notification.onclick = () => {
    window.focus()
    navigate({ to: display.targetPath })
  }
}
