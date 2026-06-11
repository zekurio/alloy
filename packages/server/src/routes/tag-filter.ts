import { sanitizeTag } from "@alloy/contracts"
import { clip, clipTag } from "@alloy/db/schema"
import { type SQL, sql } from "drizzle-orm"

/**
 * Restrict a clip query to rows carrying the given hashtag. Uses the indexed
 * `clip_tag` join table via an EXISTS subquery rather than a text scan over
 * the title/description. The tag is canonicalized so callers can pass raw
 * (`#Ace`) or bare (`ace`) forms interchangeably. An empty/unusable tag
 * produces a condition that matches nothing.
 */
export function clipTagFilter(tag: string): SQL {
  const normalized = sanitizeTag(tag)
  if (!normalized) return sql`false`
  return sql`exists (select 1 from ${clipTag} where ${clipTag.clipId} = ${clip.id} and ${clipTag.tag} = ${normalized})`
}
