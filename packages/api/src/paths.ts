export type QueryParamValue = string | number | null | undefined

export function resolvePublicUrl(path: string, origin?: string): string {
  if (!origin) return path
  return new URL(path, origin).toString()
}

export function resolvePublicUrlWithQuery(
  path: string,
  query: Record<string, QueryParamValue>,
  origin?: string
): string {
  const search = new URLSearchParams(queryParams(query))
  const suffix = search.size > 0 ? `?${search}` : ""
  return resolvePublicUrl(`${path}${suffix}`, origin)
}

export function queryParams(
  input: Record<string, QueryParamValue>
): Record<string, string> {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue
    query[key] = String(value)
  }
  return query
}

export function encodedPathSegment(value: string): string {
  return encodeURIComponent(value)
}
