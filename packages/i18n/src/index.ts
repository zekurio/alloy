import {
  LOCALES,
  SUPPORTED_LOCALES,
  type Locale,
  type TranslationCatalog,
} from "./locales"

export { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from "./locales"

export const DEFAULT_LOCALE: Locale = "en"
export const LOCALE_STORAGE_KEY = "alloy.locale"

type TranslationValue = boolean | number | string | null | undefined
export type TranslationValues = Record<string, TranslationValue>
type PluralForm = "one" | "other"

let runtimeLocale: Locale | null = null
const pluralRules = new Map<Locale, Intl.PluralRules>()

export function normalizeLocale(
  value: string | null | undefined,
): Locale | null {
  if (!value) return null
  const locale = value.trim().toLowerCase()
  return (
    SUPPORTED_LOCALES.find(
      (supported) => locale === supported || locale.startsWith(`${supported}-`),
    ) ?? null
  )
}

export function localeToLanguageTag(locale: Locale): string {
  return LOCALES[locale].languageTag
}

export function detectLocale(
  languages: Iterable<string | null | undefined>,
): Locale {
  for (const language of languages) {
    const locale = normalizeLocale(language)
    if (locale) return locale
  }
  return DEFAULT_LOCALE
}

export function setRuntimeLocale(locale: Locale): void {
  runtimeLocale = locale
}

export function getRuntimeLocale(): Locale {
  return runtimeLocale ?? getClientLocale()
}

export function getClientLocale(): Locale {
  if (!globalThis.window) return DEFAULT_LOCALE

  try {
    const stored = normalizeLocale(
      window.localStorage.getItem(LOCALE_STORAGE_KEY),
    )
    if (stored) return stored
  } catch {
    // localStorage can be unavailable in hardened/privacy contexts.
  }

  const navigatorLanguages = [
    ...(window.navigator.languages ?? []),
    window.navigator.language,
  ]

  return detectLocale(navigatorLanguages)
}

function activateLocale(locale: Locale): void {
  setRuntimeLocale(locale)
  if (globalThis.document) {
    document.documentElement.lang = localeToLanguageTag(locale)
  }
}

export function setClientLocale(locale: Locale): void {
  activateLocale(locale)
  if (!globalThis.window) return

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Best effort: the runtime locale still applies for this process.
  }
}

/**
 * Resolve the locale for a fresh boot (stored choice, else navigator
 * detection) and activate it without persisting: only an explicit choice
 * from settings is ever written to storage, so OS-language changes keep
 * taking effect until the user picks otherwise.
 */
export function initializeClientLocale(): void {
  activateLocale(getClientLocale())
}

export function translate(
  locale: Locale,
  key: string,
  values?: TranslationValues,
): string {
  const catalog: TranslationCatalog = LOCALES[locale].messages
  const template = Object.hasOwn(catalog, key) ? (catalog[key] ?? key) : key
  return interpolate(template, values)
}

/** Mark source text that will be translated later, such as search keywords. */
export function message(key: string): string {
  return key
}

export function t(key: string, values?: TranslationValues): string {
  return translate(getRuntimeLocale(), key, values)
}

export function translatePlural(
  locale: Locale,
  count: number,
  one: string,
  other = `${one}s`,
  values?: TranslationValues,
): string {
  const key = pluralForm(locale, count) === "one" ? one : other
  return translate(locale, key, { count, ...values })
}

export function tp(
  count: number,
  one: string,
  other = `${one}s`,
  values?: TranslationValues,
): string {
  return translatePlural(getRuntimeLocale(), count, one, other, values)
}

export function hasTranslation(locale: Locale, key: string): boolean {
  return (
    locale === DEFAULT_LOCALE || Object.hasOwn(LOCALES[locale].messages, key)
  )
}

function pluralForm(locale: Locale, count: number): PluralForm {
  const countForRules = Math.abs(Number.isFinite(count) ? count : 0)
  return getPluralRules(locale).select(countForRules) === "one"
    ? "one"
    : "other"
}

function getPluralRules(locale: Locale) {
  const rules = pluralRules.get(locale)
  if (rules) return rules

  const nextRules = new Intl.PluralRules(localeToLanguageTag(locale))
  pluralRules.set(locale, nextRules)
  return nextRules
}

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name]
    return value === null || value === undefined ? match : String(value)
  })
}
