import { encodedPathSegment } from "@alloy/api"

export function userProfileHref(username: string): string {
  return `/u/${encodedPathSegment(username)}`
}

export function gameHref(gameSlug: string): string {
  return `/games/${encodedPathSegment(gameSlug)}`
}

export function clipHref(gameSlug: string | null, clipId: string): string {
  // Clips without a game live under the game-agnostic canonical path.
  return gameSlug === null
    ? `/clips/${encodedPathSegment(clipId)}`
    : `${gameHref(gameSlug)}/clips/${encodedPathSegment(clipId)}`
}

export function absoluteClipHref(
  gameSlug: string | null,
  clipId: string,
  origin: string,
): string {
  return new URL(clipHref(gameSlug, clipId), origin).toString()
}
