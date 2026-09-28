export type TranslationCatalog = Readonly<Partial<Record<string, string>>>

/** Compose feature catalogs without allowing one file to overwrite another. */
export function mergeCatalogs(
  ...catalogs: readonly TranslationCatalog[]
): TranslationCatalog {
  const messages = new Map<string, string | undefined>()
  for (const catalog of catalogs) {
    for (const [key, value] of Object.entries(catalog)) {
      if (messages.has(key)) {
        throw new Error(`Duplicate translation key: ${JSON.stringify(key)}`)
      }
      messages.set(key, value)
    }
  }
  return Object.fromEntries(messages)
}
