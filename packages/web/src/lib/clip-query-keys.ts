import type { ProfileMediaParams } from "@alloy/contracts"

export const clipKeys = {
  all: ["clips"] as const,
  /** Finite user clip lists. */
  lists: () => [...clipKeys.all, "list"] as const,
  /** Infinite paged feeds. Separate branch because the data shape is paged,
   *  not a plain `ClipRow[]` list. */
  infinite: () => [...clipKeys.all, "infinite"] as const,
  profileMedia: (
    username: string,
    params: Pick<ProfileMediaParams, "tab" | "media" | "sort" | "game">,
  ) => [...clipKeys.infinite(), "profile-media", username, params] as const,
  userClips: (handle: string, sort: ProfileMediaParams["sort"]) =>
    [...clipKeys.infinite(), "user-clips", handle, { sort }] as const,
  /** Upload queue — its own branch so clip edits don't nudge it. */
  queue: () => [...clipKeys.all, "queue"] as const,
  details: () => [...clipKeys.all, "detail"] as const,
  detail: (clipId: string) => [...clipKeys.all, "detail", { clipId }] as const,
}
