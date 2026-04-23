import type {
  ClipEncodedVariant,
  ClipGameRef,
  ClipPrivacy,
  ClipRow,
} from "@workspace/api"
import { clipStreamUrl, clipThumbnailUrl } from "@workspace/api"
import { userImageSrc } from "./user-display"

/** 12.4k / 1.3k / 842 — mirrors the number style used across the UI. */
export function formatCount(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}

export function formatRelativeTime(
  iso: string,
  now: number = Date.now()
): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ""
  const delta = Math.max(0, now - then)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return "just now"
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`
  if (delta < day) return `${Math.floor(delta / hour)}h ago`
  if (delta < 7 * day) return `${Math.floor(delta / day)}d ago`
  // Longer than a week — render the date itself. `toLocaleDateString`
  // respects the viewer's locale; no explicit locale arg for that reason.
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

export function hueForGame(game: string | null | undefined): number {
  if (!game) return 220
  let h = 0
  for (let i = 0; i < game.length; i++) {
    h = (h * 31 + game.charCodeAt(i)) >>> 0
  }
  return h % 360
}

export interface ClipCardData {
  clipId: string
  slug: string
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
  views: string
  likes: string
  comments: string
  postedAt: string
  /** Full-size poster URL; omitted when the clip has no `thumbKey` yet. */
  thumbnail?: string
  /** Stream URL used for the hover-to-play preview. */
  streamUrl: string
  /** Encoded playback/download variants exposed in the player settings menu. */
  variants: ClipEncodedVariant[]
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
  return {
    clipId: row.id,
    slug: row.slug,
    title: row.title,
    game,
    gameSlug: row.gameRef?.slug ?? null,
    gameRef: row.gameRef,
    author: row.authorName || row.authorUsername,
    authorUsername: row.authorUsername,
    authorId: row.authorId,
    authorImage: userImageSrc(row.authorImage) ?? null,
    views: formatCount(row.viewCount),
    likes: formatCount(row.likeCount),
    comments: formatCount(row.commentCount),
    postedAt: formatRelativeTime(row.createdAt, now),
    thumbnail: row.thumbKey ? clipThumbnailUrl(row.id) : undefined,
    streamUrl: clipStreamUrl(row.id),
    variants: row.variants,
    accentHue: hueForGame(game),
    privacy: row.privacy,
    description: row.description,
  }
}
