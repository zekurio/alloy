import {
  encodedPathSegment,
  resolvePublicUrl,
  resolvePublicUrlWithQuery,
} from "@alloy/api"

export function userProfileHref(username: string): string {
  return `/u/${encodedPathSegment(username)}`
}

export function gameHref(steamgriddbId: number | string): string {
  return `/games/${encodedPathSegment(String(steamgriddbId))}`
}

export function clipHref(
  steamgriddbId: number | string | null,
  clipId: string,
  options: { commentId?: string | null } = {},
): string {
  // Clips without a game live under the game-agnostic canonical path.
  const path =
    steamgriddbId === null
      ? `/clips/${encodedPathSegment(clipId)}`
      : `${gameHref(steamgriddbId)}/clips/${encodedPathSegment(clipId)}`
  return resolvePublicUrlWithQuery(path, {
    comment: options.commentId ?? undefined,
  })
}

export function absoluteClipHref(
  steamgriddbId: number | string | null,
  clipId: string,
  origin: string,
  options: { commentId?: string | null } = {},
): string {
  return resolvePublicUrl(clipHref(steamgriddbId, clipId, options), origin)
}
