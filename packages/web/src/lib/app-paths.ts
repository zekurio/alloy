import { encodedPathSegment } from "@alloy/api"

export function userProfileHref(username: string): string {
  return `/u/${encodedPathSegment(username)}`
}

export function gameHref(steamgriddbId: number | string): string {
  return `/games/${encodedPathSegment(String(steamgriddbId))}`
}

export function clipHref(
  steamgriddbId: number | string | null,
  clipId: string,
): string {
  // Clips without a game live under the game-agnostic canonical path.
  return steamgriddbId === null
    ? `/clips/${encodedPathSegment(clipId)}`
    : `${gameHref(steamgriddbId)}/clips/${encodedPathSegment(clipId)}`
}

export function absoluteClipHref(
  steamgriddbId: number | string | null,
  clipId: string,
  origin: string,
): string {
  const url = new URL(clipHref(steamgriddbId, clipId), origin)
  url.searchParams.set("t", String(Date.now()))
  return url.toString()
}
