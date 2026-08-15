import { t } from "@alloy/contracts/schema"

const SearchStringSchema = t.string()

export function searchString(cause: unknown): string | undefined {
  const result = SearchStringSchema.safeParse(cause)
  if (!result.success) return undefined
  const trimmed = result.data.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function searchEnum<T extends string>(
  cause: unknown,
  allowed: readonly T[],
): T | undefined {
  const result = SearchStringSchema.safeParse(cause)
  if (!result.success) return undefined
  return allowed.find((candidate) => candidate === result.data)
}
