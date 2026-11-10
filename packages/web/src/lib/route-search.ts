import { t } from "@alloy/contracts/schema"

const SearchStringSchema = t.string()

export function searchString(cause: unknown): string | undefined {
  const result = SearchStringSchema.safeParse(cause)
  if (!result.success) return undefined
  const trimmed = result.data.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * A flag the server writes as `=true`. The router JSON-parses query values,
 * so it usually arrives as a boolean.
 */
export function searchFlag(cause: unknown): boolean {
  return cause === true || cause === "true"
}

export function searchEnum<T extends string>(
  cause: unknown,
  allowed: readonly T[],
): T | undefined {
  const result = SearchStringSchema.safeParse(cause)
  if (!result.success) return undefined
  return allowed.find((candidate) => candidate === result.data)
}
