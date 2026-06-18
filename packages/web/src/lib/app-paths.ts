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
  steamgriddbId: number | string,
  clipId: string,
  options: { commentId?: string | null } = {},
): string {
  return resolvePublicUrlWithQuery(
    `${gameHref(steamgriddbId)}/c/${encodedPathSegment(clipId)}`,
    { comment: options.commentId ?? undefined },
  )
}

export function absoluteClipHref(
  steamgriddbId: number | string,
  clipId: string,
  origin: string,
  options: { commentId?: string | null } = {},
): string {
  return resolvePublicUrl(clipHref(steamgriddbId, clipId, options), origin)
}
