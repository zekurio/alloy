/** RFC 9110 section 13.1.2 If-None-Match check using weak comparison. */
export function ifNoneMatchSatisfied(
  header: string | undefined,
  etag: string,
): boolean {
  const value = header?.trim()
  if (!value) return false

  const current = weakEtagValue(etag)
  return value.split(",").some((candidate) => {
    const token = candidate.trim()
    if (token === "*") return true
    return weakEtagValue(token) === current
  })
}

function weakEtagValue(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith("W/") ? trimmed.slice(2).trim() : trimmed
}
