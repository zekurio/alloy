import { afterEach, describe, expect, test, vi } from "vitest"

import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  detectLocale,
  getClientLocale,
  getRuntimeLocale,
  hasTranslation,
  initializeClientLocale,
  localeToLanguageTag,
  message,
  normalizeLocale,
  setClientLocale,
  setRuntimeLocale,
  t,
  tp,
  translate,
  translatePlural,
} from "../src"

afterEach(() => {
  vi.unstubAllGlobals()
  setRuntimeLocale(DEFAULT_LOCALE)
})

describe("locale selection", () => {
  test.each(SUPPORTED_LOCALES)(
    "registers %s consistently for detection and settings",
    (locale) => {
      expect(LOCALE_LABELS[locale].trim()).not.toBe("")
      expect(normalizeLocale(localeToLanguageTag(locale))).toBe(locale)
      expect(normalizeLocale(` ${locale.toUpperCase()} `)).toBe(locale)
    },
  )

  test("uses the first supported language and falls back to English", () => {
    expect(detectLocale(["x-unsupported", "de-AT", "en-US"])).toBe("de")
    expect(detectLocale(["en-GB", "de-DE"])).toBe("en")
    expect(detectLocale(["x-unsupported", null, ""])).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale("german")).toBeNull()
    expect(normalizeLocale("deutsch")).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
    expect(getClientLocale()).toBe(DEFAULT_LOCALE)
  })

  test("prefers stored choice over browser languages without persisting detection", () => {
    const storage = new Map<string, string>([[LOCALE_STORAGE_KEY, "en"]])
    const setItem = vi.fn<Storage["setItem"]>((key, value) => {
      storage.set(key, value)
    })
    const documentElement = { lang: "" }
    vi.stubGlobal("window", {
      localStorage: { getItem: (key: string) => storage.get(key), setItem },
      navigator: { languages: ["de-DE"], language: "de-DE" },
    })
    vi.stubGlobal("document", { documentElement })

    expect(getClientLocale()).toBe("en")
    storage.set(LOCALE_STORAGE_KEY, "unsupported")
    initializeClientLocale()
    expect(getRuntimeLocale()).toBe("de")
    expect(documentElement.lang).toBe("de-DE")
    expect(setItem).not.toHaveBeenCalled()

    setClientLocale("en")
    expect(setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, "en")
    expect(getRuntimeLocale()).toBe("en")
    expect(documentElement.lang).toBe("en-US")
  })

  test("still detects and changes language when browser storage is blocked", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          throw new Error("Storage blocked")
        },
        setItem() {
          throw new Error("Storage blocked")
        },
      },
      navigator: { languages: ["de-DE"], language: "de-DE" },
    })
    initializeClientLocale()
    expect(t("Settings")).toBe("Einstellungen")
    setClientLocale("en")
    expect(t("Settings")).toBe("Settings")
  })
})

describe("translation", () => {
  test("translates registered messages and leaves unknown runtime text unchanged", () => {
    expect(translate("de", "Settings")).toBe("Einstellungen")
    expect(translate("en", "Settings")).toBe("Settings")
    expect(translate("de", "Unknown server error")).toBe("Unknown server error")
    expect(translate("de", "toString")).toBe("toString")
    expect(hasTranslation("de", "Settings")).toBe(true)
    expect(hasTranslation("de", "Unknown server error")).toBe(false)
    expect(hasTranslation("de", "toString")).toBe(false)
    expect(hasTranslation("en", "Any source message")).toBe(true)
  })

  test("preserves source markers until the chosen locale translates them", () => {
    const key = message("Resolution")
    expect(key).toBe("Resolution")
    expect(translate("de", key)).toBe("Auflösung")
  })

  test("interpolates translated and fallback messages without discarding missing values", () => {
    expect(translate("de", "{count} selected", { count: 0 })).toBe(
      "0 ausgewählt",
    )
    expect(translate("de", "{label} is required", { label: "URL" })).toBe(
      "URL ist erforderlich",
    )
    expect(
      translate("de", "{flag}/{empty}/{missing}", {
        flag: false,
        empty: "",
        missing: null,
      }),
    ).toBe("false//{missing}")
    expect(translate("de", "{count} selected")).toBe("{count} ausgewählt")
  })

  test.each([
    [1, "Aufruf"],
    [-1, "Aufruf"],
    [0, "Aufrufe"],
    [2, "Aufrufe"],
    [1.5, "Aufrufe"],
    [Number.NaN, "Aufrufe"],
    [Number.POSITIVE_INFINITY, "Aufrufe"],
  ])("chooses the German plural for %s", (count, expected) => {
    expect(translatePlural("de", count, "view", "views")).toBe(expected)
  })

  test("uses runtime locale and passes counts to plural messages", () => {
    setRuntimeLocale("de")
    expect(tp(3, "{count} game", "{count} games")).toBe("3 Spiele")
    expect(tp(1, "view")).toBe("Aufruf")
    setRuntimeLocale("en")
    expect(tp(2, "view")).toBe("views")
  })
})
