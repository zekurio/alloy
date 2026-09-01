import type { ClipPrivacy } from "@alloy/api"

export type VisibilityIntent =
  | "post"
  | "unpost"
  | "create-link"
  | "disable-link"

export function profileVisibilityIntent(
  privacy: ClipPrivacy,
): VisibilityIntent {
  return privacy === "public" ? "unpost" : "post"
}

export function visibilityFeedbackIntent(
  privacy: ClipPrivacy,
  activeIntent: VisibilityIntent | null,
  feedbackActive: boolean,
): VisibilityIntent {
  return feedbackActive && activeIntent
    ? activeIntent
    : profileVisibilityIntent(privacy)
}
