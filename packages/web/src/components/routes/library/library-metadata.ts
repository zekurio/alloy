import type { UserSearchResult } from "@alloy/api"

import type { RecordingCaptureMention } from "@/lib/desktop"

export function captureMentionsFromUsers(
  mentions: UserSearchResult[],
): RecordingCaptureMention[] {
  return mentions.map((mention) => ({
    id: mention.id,
    username: mention.username,
    displayName: mention.displayName,
    image: mention.image,
  }))
}

export function captureUsersFromMentions(
  mentions: RecordingCaptureMention[],
): UserSearchResult[] {
  return mentions.map((mention) => ({
    id: mention.id,
    username: mention.username,
    displayName: mention.displayName ?? mention.username,
    image: mention.image,
  }))
}
