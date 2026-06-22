export const THEME_STORAGE_KEY = "alloy.theme"

export const THEMES = ["system", "light", "dark"] as const
export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = "system"

type ResolvedTheme = "light" | "dark"

const DARK_QUERY = "(prefers-color-scheme: dark)"

export function getStoredTheme(storageKey = THEME_STORAGE_KEY): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME

  try {
    const stored = window.localStorage.getItem(storageKey)
    if (stored === "system" || stored === "light" || stored === "dark") {
      return stored
    }
  } catch {
    // localStorage can be unavailable in hardened/privacy contexts.
  }

  return DEFAULT_THEME
}

// "system" resolves to the OS preference; falls back to dark when matchMedia
// is unavailable so behavior matches the historical dark-only default.
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme
  if (typeof window === "undefined" || !window.matchMedia) return "dark"
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return
  const resolved = resolveTheme(theme)
  const classes = document.documentElement.classList
  classes.toggle("dark", resolved === "dark")
  classes.toggle("light", resolved === "light")
}

export function setStoredTheme(
  theme: Theme,
  storageKey = THEME_STORAGE_KEY,
): void {
  applyTheme(theme)
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(storageKey, theme)
  } catch {
    // Best effort: the applied theme still holds for this session.
  }
}

// Applies the stored theme and keeps "system" in sync with live OS changes.
export function initTheme(storageKey = THEME_STORAGE_KEY): Theme {
  const theme = getStoredTheme(storageKey)
  applyTheme(theme)

  if (typeof window !== "undefined" && window.matchMedia) {
    window.matchMedia(DARK_QUERY).addEventListener("change", () => {
      if (getStoredTheme(storageKey) === "system") applyTheme("system")
    })
  }

  return theme
}
