import type { ClipFeedWindow } from "./clips-api"

export const clipKeys = {
  all: ["clips"] as const,
  /** Every finite list query (top-by-window, user-by-handle). */
  lists: () => [...clipKeys.all, "list"] as const,
  topList: (window: ClipFeedWindow, limit: number) =>
    [...clipKeys.lists(), "top", { window, limit }] as const,
  userList: (handle: string) =>
    [...clipKeys.lists(), "user", { handle }] as const,
  /** Infinite recent feed. Separate branch because its data shape is
   *  `InfiniteData<ClipRow[]>`, not `ClipRow[]`. */
  infinite: () => [...clipKeys.all, "infinite"] as const,
  recentInfinite: (limit: number) =>
    [...clipKeys.infinite(), "recent", { limit }] as const,
  /** Upload queue — its own branch so clip edits don't nudge it. */
  queue: () => [...clipKeys.all, "queue"] as const,
  /** Per-viewer like state for a single clip. */
  like: (clipId: string) => [...clipKeys.all, "like", { clipId }] as const,
  detail: (clipId: string) => [...clipKeys.all, "detail", { clipId }] as const,
}
