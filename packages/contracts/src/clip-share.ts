/**
 * The canonical public link for a clip: game-scoped when the clip has a game,
 * otherwise `/clips/:id`.
 */
export function clipShareUrl(
  clipId: string,
  gameSlug: string | null,
  origin: string,
): string {
  const clipPath = `/clips/${encodeURIComponent(clipId)}`
  const path = gameSlug
    ? `/games/${encodeURIComponent(gameSlug)}${clipPath}`
    : clipPath
  return new URL(path, origin).toString()
}
