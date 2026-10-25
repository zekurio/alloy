import type { SyncedThemePreferences } from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import {
  normalizeThemeColor,
  THEME_APPEARANCES,
  themeColorDeclarations,
  withThemeAccent,
  type ThemeAppearance,
  type ThemeColors,
} from "@alloy/ui/lib/theme-colors"
import {
  CUSTOM_THEMES_STORAGE_KEY,
  customThemeFamily,
  readCustomThemes,
  refreshCustomThemes,
  writeCustomThemes,
  type CustomTheme,
} from "@alloy/ui/lib/theme-custom"
import {
  ALLOY_THEME_ID,
  BASE_THEME_VARIANTS,
  BUILTIN_THEMES,
  DEFAULT_THEME_VARIANT_IDS,
  isBaseThemeVariant,
  themeFamilyDefault,
  type ThemeFamily,
  type ThemeVariant,
} from "@alloy/ui/lib/theme-presets"
import {
  DEFAULT_THEME_PREFERENCES,
  readThemePreferences,
  refreshThemePreferences,
  THEME_STORAGE_KEY,
  writeThemePreferences,
  type ThemePreferences,
} from "@alloy/ui/lib/theme-storage"

/**
 * The live theme: stored preferences and custom themes, the server's accent,
 * and the OS appearance, resolved into one `<style>` element. Components read
 * it through {@link getThemeState} and {@link subscribeTheme}; account sync
 * listens to {@link subscribeThemeEdits}, answers with
 * {@link applySyncedThemePreferences}, and hands over the account's custom
 * themes through {@link setCustomThemes}.
 */

export interface ThemeState {
  preferences: ThemePreferences
  /** Bundled themes first, then the user's own. */
  themes: readonly ThemeFamily[]
  customThemes: readonly CustomTheme[]
  /** Accent the server's admins chose for the Alloy base themes. */
  serverAccent: string | null
  systemAppearance: ThemeAppearance
  /** The appearance the page shows now. */
  appearance: ThemeAppearance
  light: ThemeVariant
  dark: ThemeVariant
}

const THEME_STYLE_ID = "alloy-theme"
/**
 * Last generated stylesheet, which the pre-paint script in
 * packages/web/index.html injects so the first frame already has the theme.
 */
const THEME_CSS_CACHE_KEY = "alloy.theme-css"
/**
 * The server's accent as of its last config. The config arrives after the
 * first theme pass, which would otherwise paint (and cache) Alloy's lavender
 * in the meantime.
 */
const SERVER_ACCENT_CACHE_KEY = "alloy.server-accent"
const DARK_QUERY = "(prefers-color-scheme: dark)"
const MatchMediaSchema = t.instanceof(Function)

let preferences: ThemePreferences = DEFAULT_THEME_PREFERENCES
let customThemes: readonly CustomTheme[] = []
let serverAccent: string | null = null
let systemAppearance: ThemeAppearance = "dark"
let preview: { appearance: ThemeAppearance; colors: ThemeColors } | null = null
let initialized = false
let state = buildState()
const listeners = new Set<() => void>()
const editListeners = new Set<(synced: SyncedThemePreferences) => void>()

export function getThemeState(): ThemeState {
  return state
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Called with the synced part of the preferences after each change made on
 * this device while sync is on. Changes that arrive from the account or from
 * other tabs don't fire it, so nothing echoes back.
 */
export function subscribeThemeEdits(
  listener: (synced: SyncedThemePreferences) => void,
): () => void {
  editListeners.add(listener)
  return () => editListeners.delete(listener)
}

export function syncedThemePreferences(
  current: ThemePreferences,
): SyncedThemePreferences {
  return {
    mode: current.mode,
    light: current.light,
    dark: current.dark,
    accent: current.accent,
  }
}

/** Adopts the account's theme, unless this device opted out of syncing. */
export function applySyncedThemePreferences(
  synced: SyncedThemePreferences,
): void {
  if (!preferences.sync) return
  const current = syncedThemePreferences(preferences)
  if (
    current.mode === synced.mode &&
    current.light === synced.light &&
    current.dark === synced.dark &&
    current.accent === synced.accent
  ) {
    return
  }
  preferences = writeThemePreferences({ ...preferences, ...synced })
  refresh()
}

/** Turning sync on shares this device's current theme with the account. */
export function setThemeSync(enabled: boolean): void {
  savePreferences({ ...preferences, sync: enabled })
}

/**
 * Applies the stored theme, keeps "system" in sync with live OS changes, and
 * follows edits made in other tabs.
 */
export function initTheme(): void {
  if (initialized) return
  initialized = true
  preferences = readThemePreferences()
  customThemes = readCustomThemes()
  serverAccent = readServerAccentCache()
  systemAppearance = readSystemAppearance()
  refresh()

  if (!globalThis.window) return
  if (MatchMediaSchema.safeParse(window.matchMedia).success) {
    window.matchMedia(DARK_QUERY).addEventListener("change", () => {
      systemAppearance = readSystemAppearance()
      refresh()
    })
  }
  window.addEventListener("storage", (event) => {
    // A null key means the whole store was cleared, preferences included.
    if (
      event.key !== null &&
      event.key !== THEME_STORAGE_KEY &&
      event.key !== CUSTOM_THEMES_STORAGE_KEY
    ) {
      return
    }
    preferences = refreshThemePreferences()
    customThemes = refreshCustomThemes()
    refresh()
  })
}

/**
 * The base theme picker: a monochrome base is shown right away, while
 * "system" follows the OS with whichever light and dark themes are chosen.
 */
export function selectBaseTheme(choice: "system" | string): void {
  if (choice === "system") {
    savePreferences({ ...preferences, mode: "system" })
    return
  }
  const variant = BASE_THEME_VARIANTS.find((base) => base.id === choice)
  if (!variant) return
  savePreferences(
    withVariant({ ...preferences, mode: variant.appearance }, variant),
  )
}

/**
 * One variant takes over its appearance. A fixed mode switches to that
 * appearance so the pick is visible; "system" keeps following the OS.
 */
export function selectThemeVariant(id: string): void {
  const variant = findVariant(state.themes, id)
  if (!variant) return
  const mode = preferences.mode === "system" ? "system" : variant.appearance
  savePreferences(withVariant({ ...preferences, mode }, variant))
}

/** A whole theme takes over every appearance it has. */
export function selectThemeFamily(id: string): void {
  const family = state.themes.find((candidate) => candidate.id === id)
  if (!family) return

  let next = { ...preferences }
  for (const appearance of THEME_APPEARANCES) {
    // Picking Alloy keeps whichever monochrome base is already in use.
    const keepBase =
      family.id === ALLOY_THEME_ID &&
      isBaseThemeVariant(preferences[appearance])
    const variant = keepBase ? null : themeFamilyDefault(family, appearance)
    if (variant) next = withVariant(next, variant)
  }
  // A single-appearance theme can't show in the other fixed mode.
  const onlyVariant = family.variants[0]
  if (
    next.mode !== "system" &&
    onlyVariant &&
    !themeFamilyDefault(family, next.mode)
  ) {
    next.mode = onlyVariant.appearance
  }
  savePreferences(next)
}

/** Personal accent for the Alloy base themes; null follows the server. */
export function setThemeAccent(accent: string | null): void {
  savePreferences({
    ...preferences,
    accent: accent ? normalizeThemeColor(accent) : null,
  })
}

export function setServerThemeAccent(accent: string | null): void {
  const next = accent ? normalizeThemeColor(accent) : null
  if (next === serverAccent) return
  serverAccent = next
  writeStorage(SERVER_ACCENT_CACHE_KEY, next)
  refresh()
}

/**
 * Takes the account's list of custom themes. Choices that point at a theme
 * that's gone are kept and show Alloy until it's back.
 */
export function setCustomThemes(themes: readonly CustomTheme[]): void {
  if (JSON.stringify(themes) === JSON.stringify(customThemes)) return
  customThemes = writeCustomThemes(themes)
  refresh()
}

/** Adds the theme, or replaces the stored one with the same id. */
export function saveCustomTheme(theme: CustomTheme): void {
  const exists = customThemes.some((candidate) => candidate.id === theme.id)
  customThemes = writeCustomThemes(
    exists
      ? customThemes.map((candidate) =>
          candidate.id === theme.id ? theme : candidate,
        )
      : [...customThemes, theme],
  )
  refresh()
}

/** Removes a custom theme; appearances that used it fall back to Alloy. */
export function deleteCustomTheme(id: string): void {
  const family = state.themes.find((candidate) => candidate.id === id)
  customThemes = writeCustomThemes(
    customThemes.filter((candidate) => candidate.id !== id),
  )
  const next = { ...preferences }
  for (const appearance of THEME_APPEARANCES) {
    if (family?.variants.some((variant) => variant.id === next[appearance])) {
      next[appearance] = DEFAULT_THEME_VARIANT_IDS[appearance]
    }
  }
  savePreferences(next)
}

/**
 * Shows unsaved colors on the page in their appearance until
 * {@link endThemePreview}. Nothing is stored or cached meanwhile.
 */
export function previewTheme(
  appearance: ThemeAppearance,
  colors: ThemeColors,
): void {
  preview = { appearance, colors }
  apply()
}

export function endThemePreview(): void {
  if (!preview) return
  preview = null
  apply()
}

/** The colors a variant paints with, the base themes' accent included. */
export function themeVariantColors(
  theme: ThemeState,
  variant: ThemeVariant,
): ThemeColors {
  const accent = theme.preferences.accent ?? theme.serverAccent
  return accent && isBaseThemeVariant(variant.id)
    ? withThemeAccent(variant.colors, accent)
    : variant.colors
}

function savePreferences(next: ThemePreferences): void {
  preferences = writeThemePreferences(next)
  refresh()
  if (!preferences.sync) return
  const synced = syncedThemePreferences(preferences)
  for (const listener of editListeners) listener(synced)
}

function withVariant(
  current: ThemePreferences,
  variant: ThemeVariant,
): ThemePreferences {
  return variant.appearance === "light"
    ? { ...current, light: variant.id }
    : { ...current, dark: variant.id }
}

function refresh(): void {
  state = buildState()
  apply()
  for (const listener of listeners) listener()
}

function buildState(): ThemeState {
  const themes = [...BUILTIN_THEMES, ...customThemes.map(customThemeFamily)]
  const resolve = (appearance: ThemeAppearance) =>
    findVariant(themes, preferences[appearance], appearance) ??
    defaultVariant(appearance)
  return {
    preferences,
    themes,
    customThemes,
    serverAccent,
    systemAppearance,
    appearance:
      preferences.mode === "system" ? systemAppearance : preferences.mode,
    light: resolve("light"),
    dark: resolve("dark"),
  }
}

function apply(): void {
  if (!globalThis.document) return
  const root = document.documentElement
  const appearance = preview?.appearance ?? state.appearance
  root.classList.toggle("dark", appearance === "dark")
  root.classList.toggle("light", appearance === "light")

  const accent = state.preferences.accent ?? state.serverAccent
  const bundledDefaults =
    !preview &&
    !accent &&
    state.light.id === DEFAULT_THEME_VARIANT_IDS.light &&
    state.dark.id === DEFAULT_THEME_VARIANT_IDS.dark
  if (bundledDefaults) {
    // globals.css already has exactly these colors.
    document.getElementById(THEME_STYLE_ID)?.remove()
    writeCssCache(null)
    return
  }

  const colors = (target: ThemeAppearance) =>
    preview?.appearance === target
      ? preview.colors
      : themeVariantColors(state, state[target])
  const css = themeCss(colors("dark"), colors("light"))
  const existing = document.getElementById(THEME_STYLE_ID)
  const style =
    existing instanceof HTMLStyleElement
      ? existing
      : document.createElement("style")
  style.id = THEME_STYLE_ID
  if (style.textContent !== css) style.textContent = css
  if (!style.isConnected) document.head.append(style)
  if (!preview) writeCssCache(css)
}

/**
 * Doubled selectors outrank globals.css however the stylesheets load, while
 * keeping its structure: the light root beats the dark root, and a forced
 * `.dark` subtree under a light root keeps the dark theme.
 */
function themeCss(dark: ThemeColors, light: ThemeColors): string {
  return `:root:root,\n.dark.dark {\n${themeColorDeclarations(dark)}\n}\n\n:root:root.light {\n${themeColorDeclarations(light)}\n}\n`
}

function writeCssCache(css: string | null): void {
  writeStorage(THEME_CSS_CACHE_KEY, css)
}

function readServerAccentCache(): string | null {
  try {
    const cached = localStorage.getItem(SERVER_ACCENT_CACHE_KEY)
    return cached ? normalizeThemeColor(cached) : null
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable or full; these caches only save a repaint.
  }
}

function findVariant(
  themes: readonly ThemeFamily[],
  id: string,
  appearance?: ThemeAppearance,
): ThemeVariant | undefined {
  for (const family of themes) {
    const variant = family.variants.find(
      (candidate) =>
        candidate.id === id &&
        (!appearance || candidate.appearance === appearance),
    )
    if (variant) return variant
  }
  return undefined
}

function defaultVariant(appearance: ThemeAppearance): ThemeVariant {
  const id = DEFAULT_THEME_VARIANT_IDS[appearance]
  const variant = BASE_THEME_VARIANTS.find((base) => base.id === id)
  if (!variant) throw new Error(`Missing default ${appearance} theme`)
  return variant
}

// "system" falls back to dark when matchMedia is unavailable, matching the
// pre-paint script.
function readSystemAppearance(): ThemeAppearance {
  if (!globalThis.window?.matchMedia) return "dark"
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
}
