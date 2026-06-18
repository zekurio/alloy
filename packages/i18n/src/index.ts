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

let runtimeLocale: Locale | null = null

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

export function hasTranslation(locale: Locale, key: string): boolean {
  return locale === "en" || Object.hasOwn(DE_MESSAGES, key)
}

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name]
    return value === null || value === undefined ? match : String(value)
  })
}
