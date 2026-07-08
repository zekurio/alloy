import type { NotificationItem } from "@alloy/api"
import { t } from "@alloy/i18n"

import { userProfileHref } from "./app-paths"
import { displayName } from "./user-display"

export interface NotificationDisplay {
  title: string
  body: string
  targetPath: string
}

export interface NotificationRowParts {
  before: string
  actor: string
  after: string
}

export function notificationTargetPath(item: NotificationItem): string {
  if (item.kind === "follow") return userProfileHref(item.actor.username)
  return item.clip ? `/clips/${encodeURIComponent(item.clip.id)}` : "/"
}

export function notificationDisplay(
  item: NotificationItem,
): NotificationDisplay {
  return {
    title: notificationTitle(item.kind),
    body: notificationBody(item, displayName(item.actor)),
    targetPath: notificationTargetPath(item),
  }
}

/**
 * Splits the translated body around the actor's name so the UI can emphasize
 * it without hardcoding word order. The body is translated with a sentinel
 * in the actor slot, then cut at the sentinel — locales that place the actor
 * mid-sentence keep their natural order.
 */
export function notificationRowParts(
  item: NotificationItem,
): NotificationRowParts {
  const body = notificationBody(item, ACTOR_SENTINEL)
  const cut = body.indexOf(ACTOR_SENTINEL)
  if (cut === -1) return { before: body, actor: "", after: "" }
  return {
    before: body.slice(0, cut),
    actor: displayName(item.actor),
    after: body.slice(cut + ACTOR_SENTINEL.length),
  }
}

const ACTOR_SENTINEL = "\u0000"

function notificationTitle(kind: NotificationItem["kind"]): string {
  switch (kind) {
    case "follow":
      return t("New follower")
    case "clip_like":
      return t("Clip liked")
    case "clip_comment":
      return t("New comment")
    case "comment_reply":
      return t("New reply")
    case "clip_mention":
    case "comment_mention":
      return t("You were mentioned")
    case "comment_like":
      return t("Comment liked")
  }
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
