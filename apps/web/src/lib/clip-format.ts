import {
  type ClipGameRef,
  type ClipPrivacy,
  type ClipRow,
  clipStreamUrl,
  clipThumbnailUrl,
} from "@workspace/api"
import { stableHue } from "@workspace/ui/lib/stable-hash"
import { formatRelativeTime } from "./date-format"
import { apiOrigin } from "./env"
import { formatCount } from "./number-format"
import { type UserAvatar, userAvatar } from "./user-display"

export function hueForGame(game: string | null | undefined): number {
  if (!game) return 220
  return stableHue(game)
}

interface ClipCardData {
  clipId: string
  title: string
  game: string
  gameSlug: string | null
  gameRef: ClipGameRef | null
  /** Display label for the author — name or handle, chosen for readability. */
  author: string
  /** Lowercase handle (`user.username`) — always use this for profile links. */
  authorUsername: string
  authorId: string
  /** Uploader's avatar image URL when set — `null` when none is available. */
  authorImage: string | null
  authorAvatar: UserAvatar
  views: string
  likes: string
  comments: string
  postedAt: string
  /** Full-size poster URL; omitted when the clip has no `thumbKey` yet. */
  thumbnail?: string
  /** Stream URL used for the hover-to-play preview. */
  streamUrl: string
  accentHue: number
  /** Stored privacy setting — whether the card surfaces it is up to the caller. */
  privacy: ClipPrivacy
  description: string | null
}

export function clipGameLabel(row: Pick<ClipRow, "gameRef" | "game">): string {
  return row.gameRef?.name ?? row.game ?? "Uncategorised"
}

export function toClipCardData(row: ClipRow, now?: number): ClipCardData {
  const game = clipGameLabel(row)
  const authorAvatar = userAvatar({
    id: row.authorId,
    name: row.authorName,
    username: row.authorUsername,
    image: row.authorImage,
  })
  return {
    clipId: row.id,
    title: row.title,
    game,
    gameSlug: row.gameRef?.slug ?? null,
    gameRef: row.gameRef,
    author: row.authorName || row.authorUsername,
    authorUsername: row.authorUsername,
    authorId: row.authorId,
    authorImage: authorAvatar.src ?? null,
    authorAvatar,
    views: formatCount(row.viewCount),
    likes: formatCount(row.likeCount),
    comments: formatCount(row.commentCount),
    postedAt: formatRelativeTime(row.createdAt, now),
    thumbnail: row.thumbKey
      ? clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
      : undefined,
    streamUrl: clipStreamUrl(row.id, undefined, apiOrigin()),
    accentHue: hueForGame(game),
    privacy: row.privacy,
    description: row.description,
  }
}
