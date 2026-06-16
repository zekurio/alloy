import type { UserSearchResult } from "@alloy/api"

import type { RecordingCaptureMention } from "@/lib/desktop"

export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const id of b) if (!set.has(id)) return false
  return true
}

export function captureMentionsFromUsers(
  mentions: UserSearchResult[],
): RecordingCaptureMention[] {
  return mentions.map((mention) => ({
    id: mention.id,
    username: mention.username,
    displayUsername: mention.displayUsername,
    image: mention.image,
  }))
}
