import { t } from "@alloy/contracts/schema"
import { applyStoredThemeAccents } from "@alloy/ui/lib/theme-accent"
import { applyStoredThemePresets } from "@alloy/ui/lib/theme-presets"
import {
  readThemePreferences,
  refreshThemePreferences,
  THEME_STORAGE_KEY,
  type Theme,
  writeThemePreferences,
} from "@alloy/ui/lib/theme-storage"

export {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  type Theme,
} from "@alloy/ui/lib/theme-storage"

type ResolvedTheme = "light" | "dark"

const DARK_QUERY = "(prefers-color-scheme: dark)"
const MatchMediaSchema = t.instanceof(Function)

export function getStoredTheme(): Theme {
  return readThemePreferences().mode
}

// "system" resolves to the OS preference; falls back to dark when matchMedia
// is unavailable so behavior matches the historical dark-only default.
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme
  if (!globalThis.window?.matchMedia) return "dark"
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
}

export function applyTheme(theme: Theme): void {
  if (!globalThis.document) return
  const resolved = resolveTheme(theme)
  const classes = document.documentElement.classList
  classes.toggle("dark", resolved === "dark")
  classes.toggle("light", resolved === "light")
}

export function setStoredTheme(theme: Theme): void {
  const preferences = readThemePreferences()
  const stored = writeThemePreferences({ ...preferences, mode: theme })
  applyTheme(stored.mode)
}

// Applies the stored theme preferences, keeps "system" in sync with live OS
// changes, and follows edits made in other tabs.
export function initTheme(): Theme {
  const theme = getStoredTheme()
  applyTheme(theme)
  applyStoredThemePresets()
  applyStoredThemeAccents()

  if (
    globalThis.window &&
    MatchMediaSchema.safeParse(window.matchMedia).success
  ) {
    window.matchMedia(DARK_QUERY).addEventListener("change", () => {
      if (getStoredTheme() === "system") applyTheme("system")
    })
  }

  if (globalThis.window) {
    window.addEventListener("storage", (event) => {
      // A null key means the whole store was cleared, preferences included.
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
      const preferences = refreshThemePreferences()
      applyTheme(preferences.mode)
      applyStoredThemePresets()
      applyStoredThemeAccents()
    })
  }

  return theme
}
