import type { UserSummary } from "./content"

export const NOTIFICATION_KINDS = [
  "follow",
  "clip_like",
  "clip_comment",
  "comment_reply",
  "clip_mention",
  "comment_mention",
  "comment_like",
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export interface NotificationItem {
  id: string
  kind: NotificationKind
  actor: UserSummary
  clip: { id: string; title: string; thumbVersion: string | null } | null
  commentId: string | null
  commentSnippet: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationListResponse {
  items: NotificationItem[]
  nextCursor: string | null
}

export type NotificationStreamEvent = {
  type: "notification"
  item: NotificationItem
}
