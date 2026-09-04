import type { NotificationItem } from "@alloy/contracts"
import {
  evaluateClipAccess,
  type ClipViewer,
} from "@alloy/server/clips/access-policy"

import { clipAssetVersion } from "../clips/asset-version"

export type NotificationClipSource = {
  id: string
  authorId: string
  authorDisabledAt: Date | null
  privacy: string
  status: string
  title: string
  thumbKey: string | null
}

export type NotificationCommentSource = {
  id: string
  body: string
  clipId: string
  clip: NotificationClipSource
}

type NotificationReferenceFields = Pick<
  NotificationItem,
  "clip" | "commentId" | "commentSnippet"
>

export function notificationReferenceFields(
  viewer: Exclude<ClipViewer, null>,
  clipId: string | null,
  commentId: string | null,
  clip: NotificationClipSource | null,
  comment: NotificationCommentSource | null,
): NotificationReferenceFields {
  const clipSummary =
    clipId !== null && clip?.id === clipId && canHydrateClip(viewer, clip)
      ? {
          id: clip.id,
          title: clip.title,
          thumbVersion: clip.thumbKey ? clipAssetVersion(clip.thumbKey) : null,
        }
      : null
  const commentVisible =
    commentId !== null &&
    comment?.id === commentId &&
    canHydrateClip(viewer, comment.clip) &&
    (clipId === null || (clipSummary !== null && comment.clipId === clipId))

  return {
    clip: clipSummary,
    commentId: commentVisible ? commentId : null,
    commentSnippet: commentVisible ? comment.body.slice(0, 80) : null,
  }
}

function canHydrateClip(
  viewer: Exclude<ClipViewer, null>,
  row: NotificationClipSource,
): boolean {
  return evaluateClipAccess({
    authorDisabledAt: row.authorDisabledAt,
    authorId: row.authorId,
    policy: "metadata",
    privacy: row.privacy,
    status: row.status,
    viewer,
  }).accessible
}
