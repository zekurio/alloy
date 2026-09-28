import type { TranslationCatalog } from "../src/locales"

export function placeholders(message: string): string[] {
  return [
    ...new Set(
      Array.from(message.matchAll(/\{([a-zA-Z0-9_]+)\}/g), (match) => match[1]),
    ),
  ].sort()
}

export function validateCatalog(
  catalog: TranslationCatalog,
  sourceKeys: Iterable<string>,
): string[] {
  const issues: string[] = []
  for (const key of sourceKeys) {
    if (!Object.hasOwn(catalog, key))
      issues.push(`Missing translation: ${JSON.stringify(key)}`)
  }
  for (const [key, translation] of Object.entries(catalog)) {
    if (!translation?.trim()) {
      issues.push(`Empty translation: ${JSON.stringify(key)}`)
      continue
    }
    const expected = placeholders(key)
    const actual = placeholders(translation)
    if (expected.join(",") !== actual.join(",")) {
      issues.push(
        `Placeholder mismatch: ${JSON.stringify(key)}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      )
    }
    if (
      /^\s/.test(key) !== /^\s/.test(translation) ||
      /\s$/.test(key) !== /\s$/.test(translation)
    ) {
      issues.push(`Boundary whitespace mismatch: ${JSON.stringify(key)}`)
    }
  }
  return issues
}
