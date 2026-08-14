import type { NotificationItem } from "@alloy/api"
import { t } from "@alloy/i18n"

import { clipHref, userProfileHref } from "./app-paths"
import { dateTime } from "./date-format"
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
  if (item.kind === "follow" && item.actor) {
    return userProfileHref(item.actor.username)
  }
  return item.clip
    ? clipHref(null, item.clip.id, { commentId: item.commentId })
    : "/"
}

export function notificationDisplay(
  item: NotificationItem,
): NotificationDisplay {
  return {
    title: notificationTitle(item.kind),
    body: notificationBody(item, item.actor ? displayName(item.actor) : ""),
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
    actor: item.actor ? displayName(item.actor) : "",
    after: body.slice(cut + ACTOR_SENTINEL.length),
  }
}

const ACTOR_SENTINEL = "\u0000"

export type NotificationSectionId =
  | "new"
  | "today"
  | "yesterday"
  | "week"
  | "earlier"

export interface NotificationSection {
  id: NotificationSectionId
  items: NotificationItem[]
}

const SECTION_ORDER: NotificationSectionId[] = [
  "new",
  "today",
  "yesterday",
  "week",
  "earlier",
]

/**
 * Buckets a chronologically sorted notification list into recency sections.
 * Unread items land in "new" regardless of age so they stay one glance away;
 * read items fall into calendar buckets (today, yesterday, the last 7 days).
 */
export function groupNotificationsByRecency(
  items: NotificationItem[],
  now: Date = new Date(),
): NotificationSection[] {
  // Calendar-day boundaries; setDate arithmetic stays correct across DST.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const week = new Date(today)
  week.setDate(week.getDate() - 6)

  const groups = new Map<NotificationSectionId, NotificationItem[]>()
  for (const item of items) {
    const id = notificationSectionId(item, { today, yesterday, week })
    const group = groups.get(id)
    if (group) group.push(item)
    else groups.set(id, [item])
  }

  return SECTION_ORDER.flatMap((id) => {
    const group = groups.get(id)
    return group ? [{ id, items: group }] : []
  })
}

function notificationSectionId(
  item: NotificationItem,
  bounds: { today: Date; yesterday: Date; week: Date },
): NotificationSectionId {
  if (item.readAt === null) return "new"
  const created = dateTime(item.createdAt) ?? 0
  if (created >= bounds.today.getTime()) return "today"
  if (created >= bounds.yesterday.getTime()) return "yesterday"
  if (created >= bounds.week.getTime()) return "week"
  return "earlier"
}

export function notificationSectionLabel(id: NotificationSectionId): string {
  switch (id) {
    case "new":
      return t("New")
    case "today":
      return t("Today")
    case "yesterday":
      return t("Yesterday")
    case "week":
      return t("This week")
    case "earlier":
      return t("Earlier")
  }
}

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
