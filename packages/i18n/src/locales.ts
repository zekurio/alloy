import { DE_MESSAGES } from "./catalogs/de"

export type { TranslationCatalog } from "./catalogs/catalog"

/** Add a locale here to include it in detection, settings, and validation. */
export const LOCALES = {
  en: { label: "English", languageTag: "en-US", messages: {} },
  de: { label: "Deutsch", languageTag: "de-DE", messages: DE_MESSAGES },
}

export type Locale = keyof typeof LOCALES

// SAFETY: Object.keys returns exactly the keys of this locally declared registry.
const SUPPORTED_LOCALES = Object.freeze(Object.keys(LOCALES) as Locale[])

// SAFETY: Every supported locale contributes its label, without filtering.
const LOCALE_LABELS = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, LOCALES[locale].label]),
) as Record<Locale, string>

export { LOCALE_LABELS, SUPPORTED_LOCALES }
