import { clip } from "@workspace/db/schema"
import { or, type SQL, sql } from "drizzle-orm"

import { requiredSql } from "../db/sql"

const REGEXP_SPECIAL = /[\\^$.*+?()[\]{}|]/g

function normalizeHashtag(value: string): string {
  return value.replace(/^#/, "").trim()
}

export function hashtagTextFilter(tag: string): SQL {
  const escaped = normalizeHashtag(tag).replace(REGEXP_SPECIAL, "\\$&")
  const pattern = `(^|[^[:alnum:]_])#${escaped}($|[^[:alnum:]_])`
  return requiredSql(
    or(
      sql`${clip.title} ~* ${pattern}`,
      sql`coalesce(${clip.description}, '') ~* ${pattern}`,
    ),
    "hashtag text filter",
  )
}
