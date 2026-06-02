import type { SQL } from "drizzle-orm"

export function requiredSql(condition: SQL | undefined, label: string): SQL {
  if (!condition) throw new Error(`Missing SQL condition: ${label}`)
  return condition
}
