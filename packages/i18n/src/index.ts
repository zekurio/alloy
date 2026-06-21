import { DE_MESSAGES } from "./messages"

export const SUPPORTED_LOCALES = ["en", "de"] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "en"
export const LOCALE_STORAGE_KEY = "alloy.locale"

export const LOCALE_LABELS: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
}

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
  if (locale === "de" || locale.startsWith("de-")) return "de"
  if (locale === "en" || locale.startsWith("en-")) return "en"
  return null
}

export function localeToLanguageTag(locale: Locale): string {
  return locale === "de" ? "de-DE" : "en-US"
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

export function getClientLocale(storageKey = LOCALE_STORAGE_KEY): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE

  try {
    const stored = normalizeLocale(window.localStorage.getItem(storageKey))
    if (stored) return stored
  } catch {
    // localStorage can be unavailable in hardened/privacy contexts.
  }

  const navigatorLanguages =
    typeof window.navigator === "undefined"
      ? []
      : [...(window.navigator.languages ?? []), window.navigator.language]

  return detectLocale(navigatorLanguages)
}

export function setClientLocale(
  locale: Locale,
  storageKey = LOCALE_STORAGE_KEY,
): void {
  setRuntimeLocale(locale)
  if (typeof document !== "undefined") {
    document.documentElement.lang = localeToLanguageTag(locale)
  }
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(storageKey, locale)
  } catch {
    // Best effort: the runtime locale still applies for this process.
  }
}

export function initializeClientLocale(
  storageKey = LOCALE_STORAGE_KEY,
): Locale {
  const locale = getClientLocale(storageKey)
  setClientLocale(locale, storageKey)
  return locale
}

export function translate(
  locale: Locale,
  key: string,
  values?: TranslationValues,
): string {
  const template = locale === "de" ? (DE_MESSAGES[key] ?? key) : key
  return interpolate(template, values)
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
  return locale === "en" || Object.hasOwn(DE_MESSAGES, key)
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
