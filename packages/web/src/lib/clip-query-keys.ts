export const clipKeys = {
  all: ["clips"] as const,
  /** Finite user clip lists. */
  lists: () => [...clipKeys.all, "list"] as const,
  userList: (handle: string) =>
    [...clipKeys.lists(), "user", { handle }] as const,
  /** Infinite paged feeds. Separate branch because the data shape is paged,
   *  not a plain `ClipRow[]` list. */
  infinite: () => [...clipKeys.all, "infinite"] as const,
  /** Upload queue — its own branch so clip edits don't nudge it. */
  queue: () => [...clipKeys.all, "queue"] as const,
  details: () => [...clipKeys.all, "detail"] as const,
  detail: (clipId: string) => [...clipKeys.all, "detail", { clipId }] as const,
}
