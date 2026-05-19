import { or, sql, type SQL } from "drizzle-orm"

import { clip } from "@workspace/db/schema"

const REGEXP_SPECIAL = /[\\^$.*+?()[\]{}|]/g

export function normalizeHashtag(value: string): string {
  return value.replace(/^#/, "").trim()
}

export function hashtagTextFilter(tag: string): SQL {
  const escaped = normalizeHashtag(tag).replace(REGEXP_SPECIAL, "\\$&")
  const pattern = `(^|[^[:alnum:]_])#${escaped}($|[^[:alnum:]_])`
  return or(
    sql`${clip.title} ~* ${pattern}`,
    sql`coalesce(${clip.description}, '') ~* ${pattern}`
  )!
}
