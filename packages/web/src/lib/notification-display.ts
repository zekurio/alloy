import type { NotificationItem } from "@alloy/api"
import { t } from "@alloy/i18n"

import { userProfileHref } from "./app-paths"
import { displayName } from "./user-display"

export interface NotificationDisplay {
  title: string
  body: string
  targetPath: string
}

export function notificationTargetPath(item: NotificationItem): string {
  if (item.kind === "follow") return userProfileHref(item.actor.username)
  return item.clip ? `/clips/${encodeURIComponent(item.clip.id)}` : "/"
}

export function notificationDisplay(
  item: NotificationItem,
): NotificationDisplay {
  const actor = displayName(item.actor)
  const targetPath = notificationTargetPath(item)
  if (item.kind === "follow") {
    return {
      title: t("New follower"),
      body: t("{actor} followed you", { actor }),
      targetPath,
    }
  }
  const body = notificationBody(item, actor)
  return { title: t("New notification"), body, targetPath }
}

function notificationBody(item: NotificationItem, actor: string): string {
  switch (item.kind) {
    case "clip_like":
      return t("{actor} liked your clip", { actor })
    case "clip_comment":
      return t("{actor} commented on your clip", { actor })
    case "comment_reply":
      return t("{actor} replied to your comment", { actor })
    case "clip_mention":
      return t("{actor} mentioned you in a clip", { actor })
    case "comment_mention":
      return t("{actor} mentioned you in a comment", { actor })
    case "comment_like":
      return t("{actor} liked your comment", { actor })
    case "follow":
      return t("{actor} followed you", { actor })
  }
}
