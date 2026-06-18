export const clipKeys = {
  all: ["clips"] as const,
  /** Every finite list query (user-by-handle, liked). */
  lists: () => [...clipKeys.all, "list"] as const,
  userList: (handle: string) =>
    [...clipKeys.lists(), "user", { handle }] as const,
  userLikedList: (handle: string) =>
    [...clipKeys.lists(), "user-liked", { handle }] as const,
  /** Infinite paged feeds. Separate branch because the data shape is paged,
   *  not a plain `ClipRow[]` list. */
  infinite: () => [...clipKeys.all, "infinite"] as const,
  /** Upload queue — its own branch so clip edits don't nudge it. */
  queue: () => [...clipKeys.all, "queue"] as const,
  /** Per-viewer like state for a single clip. */
  like: (clipId: string) => [...clipKeys.all, "like", { clipId }] as const,
  details: () => [...clipKeys.all, "detail"] as const,
  detail: (clipId: string) => [...clipKeys.all, "detail", { clipId }] as const,
}
