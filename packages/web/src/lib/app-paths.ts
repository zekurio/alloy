import { encodedPathSegment } from "@alloy/api"
import { UNCATEGORISED_GAME_SLUG } from "@alloy/contracts"

export function userProfileHref(username: string): string {
  return `/u/${encodedPathSegment(username)}`
}

export function gameHref(gameSlug: string): string {
  return `/games/${encodedPathSegment(gameSlug)}`
}

export function clipHref(gameSlug: string | null, clipId: string): string {
  // Clips without a game live under the uncategorised group.
  return `${gameHref(gameSlug ?? UNCATEGORISED_GAME_SLUG)}/clips/${encodedPathSegment(clipId)}`
}

export function absoluteClipHref(
  gameSlug: string | null,
  clipId: string,
  origin: string,
): string {
  return new URL(clipHref(gameSlug, clipId), origin).toString()
}
