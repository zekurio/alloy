import type { NotificationItem } from "@alloy/api"

import { alloyDesktop } from "./desktop"
import { notificationDisplay } from "./notification-display"

export type NotificationNavigator = (options: { to: string }) => void

export function presentNotification(
  item: NotificationItem,
  navigate: NotificationNavigator,
): void {
  if (document.visibilityState === "visible") return
  const display = notificationDisplay(item)
  const desktop = alloyDesktop()
  if (desktop?.notifications) {
    void desktop.notifications.show({
      title: display.title,
      body: display.body,
      targetPath: display.targetPath,
    })
    return
  }
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return
  }
  const notification = new Notification(display.title, {
    body: display.body,
    tag: item.id,
  })
  notification.onclick = () => {
    window.focus()
    navigate({ to: display.targetPath })
  }
}
