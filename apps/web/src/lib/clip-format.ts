import type {
  ClipEncodedVariant,
  ClipGameRef,
  ClipPrivacy,
  ClipRow,
} from "./clips-api"
import { clipStreamUrl, clipThumbnailUrl } from "./clips-api"

/**
 * Pure formatting helpers that turn a raw `ClipRow` into the display
 * strings and URLs the card / player / meta components need. Kept in one
 * place so the home feed, profile page, and any future surface (explore,
 * search) share the same presentation.
 *
 * These are all synchronous: no network, no side effects. `ClipCard`
 * already renders a gradient placeholder when `thumbnail` is missing, so
 * we only hand it a URL when the row has a `thumbKey` — otherwise the
 * placeholder handles empty/encoding clips without an extra 404 round trip.
 */

/** 12.4k / 1.3k / 842 — mirrors the number style used across the UI. */
export function formatCount(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}

/**
 * "2h ago" / "3d ago" / "Mar 14". The feed clusters around recent
 * activity so minutes/hours/days cover most cases; anything beyond a
 * week is a date so viewers can tell a one-off old clip from "this
 * week". Future dates are clamped to "just now" — clock skew between
 * client and server shouldn't surface as "in 3m".
 */
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

/**
 * Deterministic hue per game name (same mapping the profile page uses)
 * so a given game always gets the same placeholder color across surfaces.
 * Null games fall back to the accent-blue family.
 */
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
  /**
   * Human label for the game badge. Resolved in priority order:
   * `gameRef.name` (the mapped SteamGridDB game), then the legacy
   * free-text `game` column for pre-integration rows, then
   * "Uncategorised" for unlabeled clips.
   */
  game: string
  /**
   * Slug for the `/g/:slug` link, `null` when the clip isn't mapped
   * to a SteamGridDB game. Cards branch on this to render the badge
   * as a link vs. plain text — legacy text-only rows don't have a
   * destination yet (a future backfill would mint them).
   */
  gameSlug: string | null
  /**
   * Full mapped-game reference when present. Threaded into the player
   * dialog so the inline game editor can seed its combobox with the
   * current pick without a fresh `/api/games/:slug` round trip. `null`
   * for legacy text-only rows and for clips with no game set.
   */
  gameRef: ClipGameRef | null
  /** Display handle for the author (maps onto `user.username`). */
  author: string
  /**
   * Uploader's user id. Surfaces here so the card call sites can compare
   * against the viewer's session and decide whether to show owner-only
   * affordances (e.g. the privacy indicator).
   */
  authorId: string
  /** Uploader's avatar image URL when set — `null` when they have no upload. */
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
  /**
   * Author-supplied description. `null` when unset. Surfaced below the
   * player in `ClipMeta` for every viewer, and is the target of inline
   * editing for owners — threaded here so the dialog doesn't need a
   * second fetch once the viewer opens the player.
   */
  description: string | null
}

/**
 * Resolve the human game label for a clip in one place. Priority:
 * mapped game → legacy text → "Uncategorised". Keeping this in a
 * helper stops the fallback chain from drifting between the card,
 * the player dialog, and the meta row.
 */
export function clipGameLabel(row: Pick<ClipRow, "gameRef" | "game">): string {
  return row.gameRef?.name ?? row.game ?? "Uncategorised"
}

/**
 * Map a raw clip row to the string-shaped props `ClipCard` expects.
 * Everything is pre-formatted so the card stays presentational and the
 * same payload can feed `ClipPlayerDialog` without a second pass.
 */
export function toClipCardData(row: ClipRow, now?: number): ClipCardData {
  const game = clipGameLabel(row)
  return {
    clipId: row.id,
    slug: row.slug,
    title: row.title,
    game,
    gameSlug: row.gameRef?.slug ?? null,
    gameRef: row.gameRef,
    author: row.authorUsername,
    authorId: row.authorId,
    authorImage: row.authorImage,
    views: formatCount(row.viewCount),
    likes: formatCount(row.likeCount),
    comments: formatCount(row.commentCount),
    postedAt: formatRelativeTime(row.createdAt, now),
    thumbnail: row.thumbKey ? clipThumbnailUrl(row.id, "full") : undefined,
    streamUrl: clipStreamUrl(row.id),
    variants: row.variants,
    accentHue: hueForGame(game),
    privacy: row.privacy,
    description: row.description,
  }
}
