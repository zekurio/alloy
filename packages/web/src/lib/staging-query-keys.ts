import type { RecordingKind } from "@alloy/api"

/** Query-key factory for owner-only staging recordings. */
export const stagingKeys = {
  all: ["staging"] as const,
  lists: () => [...stagingKeys.all, "list"] as const,
  list: (kind?: RecordingKind) =>
    [...stagingKeys.lists(), kind ?? "all"] as const,
  details: () => [...stagingKeys.all, "detail"] as const,
  detail: (id: string) => [...stagingKeys.details(), id] as const,
}
