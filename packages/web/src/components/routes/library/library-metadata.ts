import type { UserSearchResult } from "@alloy/api"

import type { RecordingCaptureMention } from "@/lib/desktop"

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
