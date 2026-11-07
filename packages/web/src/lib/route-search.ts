import { t } from "@alloy/contracts/schema"

const SearchStringSchema = t.string()

export function searchString(cause: unknown): string | undefined {
  const result = SearchStringSchema.safeParse(cause)
  if (!result.success) return undefined
  const trimmed = result.data.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * A presence flag. Any non-empty value counts, so URLs from older servers that
 * put the provider ID in the flag (`link=oidc`, `welcome=oidc`) still set it.
 */
export function searchFlag(cause: unknown): boolean {
  return cause === true || searchString(cause) !== undefined
}

export function searchEnum<T extends string>(
  cause: unknown,
  allowed: readonly T[],
): T | undefined {
  const result = SearchStringSchema.safeParse(cause)
  if (!result.success) return undefined
  return allowed.find((candidate) => candidate === result.data)
}
