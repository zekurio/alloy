// Clip permalinks are game-scoped. The bare form is the legacy link from
// before every clip lived under a game or the uncategorised group; social
// crawlers still hand it back for links shared back then.
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
