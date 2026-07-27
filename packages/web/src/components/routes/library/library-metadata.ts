import type { UserSearchResult } from "@alloy/api"

import type { RecordingCaptureMention } from "@/lib/desktop"

export function captureMentionsFromUsers(
  mentions: UserSearchResult[],
): RecordingCaptureMention[] {
  return mentions.map((mention) => ({
    id: mention.id,
    username: mention.username,
    image: mention.image,
  }))
}

/**
 * Capture drafts are persisted on disk by the desktop app and deliberately
 * store only enough to rehydrate the picker, so they carry no display name.
 * A fresh one arrives with the next user search.
 */
export function usersFromCaptureMentions(
  mentions: RecordingCaptureMention[],
): UserSearchResult[] {
  return mentions.map((mention) => ({ ...mention, displayName: null }))
}
