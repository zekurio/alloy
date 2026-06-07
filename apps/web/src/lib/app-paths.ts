import {
  encodedPathSegment,
  resolvePublicUrl,
  resolvePublicUrlWithQuery,
} from "alloy-api"

export function userProfileHref(username: string): string {
  return `/u/${encodedPathSegment(username)}`
}

export function gameHref(slug: string): string {
  return `/g/${encodedPathSegment(slug)}`
}

export function clipHref(
  gameSlug: string,
  clipId: string,
  options: { commentId?: string | null } = {},
): string {
  return resolvePublicUrlWithQuery(
    `${gameHref(gameSlug)}/c/${encodedPathSegment(clipId)}`,
    { comment: options.commentId ?? undefined },
  )
}

export function absoluteClipHref(
  gameSlug: string,
  clipId: string,
  origin: string,
  options: { commentId?: string | null } = {},
): string {
  return resolvePublicUrl(clipHref(gameSlug, clipId, options), origin)
}
