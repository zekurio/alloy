/** Longest a single hashtag may be, in characters (after sanitizing). */
export const CLIP_TAG_MAX_LENGTH = 50
/** Most hashtags a single clip may carry. */
export const CLIP_TAGS_MAX = 10

/**
 * Canonicalize a raw hashtag into its stored form: drop a leading `#`, strip
 * anything that isn't a letter/number/underscore, and lowercase so `#Ace` and
 * `#ace` collapse to one tag. Returns the bare tag, truncated to the max
 * length, or an empty string if nothing usable remains.
 */
export function sanitizeTag(value: string): string {
  return value
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .toLowerCase()
    .slice(0, CLIP_TAG_MAX_LENGTH)
}

/**
 * Sanitize, de-duplicate, and cap a list of raw hashtags into the canonical
 * tag list persisted on a clip. Empty results are dropped; order of first
 * appearance is preserved.
 */
export function normalizeTags(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const value of values) {
    const tag = sanitizeTag(value)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= CLIP_TAGS_MAX) break
  }
  return tags
}
