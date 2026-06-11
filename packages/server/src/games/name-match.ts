export function uniqueLookupNames(names: string[], max: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (!trimmed) continue

    const key = exactNameKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
    if (result.length >= max) break
  }
  return result
}

export function exactNameKey(name: string): string {
  return name.trim().toLowerCase()
}

export function normalizedNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[™®©]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}
