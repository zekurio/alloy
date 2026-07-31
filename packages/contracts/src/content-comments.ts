import type { UserSummary } from "./content-users"
import type { IsoDateString } from "./shared"

export type CommentAuthor = UserSummary

export const COMMENT_BODY_MAX_LENGTH = 2000
// Captures @mentions after start/whitespace/open punctuation and stops at
// whitespace, another @, or path separators. Usernames may contain unicode,
// dots, and dashes; trailing sentence punctuation is trimmed by the parser.
export const MENTION_PATTERN = /(?:^|[\s([{])@([^\s@/\\]{1,24})/gu

export function parseMentionUsernames(text: string): string[] {
  const trailingPunctuation = /[.,!?;:)\]}]+$/u
  const out = new Set<string>()
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const username = match[1].replace(trailingPunctuation, "").toLowerCase()
    if (username) out.add(username)
  }
  return [...out]
}

export interface CommentRow {
  id: string
  clipId: string
  parentId: string | null
  body: string
  likeCount: number
  pinnedAt: IsoDateString | null
  createdAt: IsoDateString
  editedAt: IsoDateString | null
  pinned: boolean
  likedByViewer: boolean
  likedByAuthor: boolean
  author: CommentAuthor
  mentions: string[]
  replies: CommentRow[]
}

export type CommentSort = "top" | "new"

export interface CommentPage {
  items: CommentRow[]
  nextCursor: string | null
}
