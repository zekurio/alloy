import { UNCATEGORISED_GAME_SLUG } from "./content-games"

/**
 * The canonical public link for a clip. Every clip lives under a game, and
 * clips without one under the uncategorised group.
 */
export function clipShareUrl(
  clipId: string,
  gameSlug: string | null,
  origin: string,
): string {
  const path = `/games/${encodeURIComponent(gameSlug ?? UNCATEGORISED_GAME_SLUG)}/clips/${encodeURIComponent(clipId)}`
  return new URL(path, origin).toString()
}
