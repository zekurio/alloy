// Clip permalinks come in a bare and a game-scoped form; both address the same
// clip, and social crawlers will hand back whichever the user pasted.
const CLIP_PERMALINK_RE = /^(?:\/games\/[^/]+)?\/clips\/([^/]+)\/?$/

export function clipIdFromPath(pathname: string): string | null {
  return CLIP_PERMALINK_RE.exec(pathname)?.[1] ?? null
}

/**
 * Resolve a full permalink to a clip id, rejecting anything that is not ours.
 * The url arrives from an untrusted oEmbed caller, so a foreign origin must
 * never resolve to one of our clips.
 */
export function clipIdFromPermalink(
  value: string,
  origin: string,
): string | null {
  const url = URL.parse(value, origin)
  if (!url) return null
  if (url.origin !== new URL(origin).origin) return null
  return clipIdFromPath(url.pathname)
}
