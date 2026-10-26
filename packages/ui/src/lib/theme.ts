import {
  NO_THEME_ACCENTS,
  ThemeAccentsSchema,
  type SyncedThemePreferences,
  type ThemeAccents,
  type ThemeMode,
} from "@alloy/contracts"
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
  BUILTIN_THEMES,
  DEFAULT_THEME_VARIANT_IDS,
  DEFAULT_THEME_VARIANTS,
  isAlloyThemeVariant,
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
 * The live theme: stored preferences and custom themes, the server's accents,
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
  /** Accents the server's admins chose for the Alloy theme. */
  serverAccents: ThemeAccents
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
 * The server's accents as of its last config. The config arrives after the
 * first theme pass, which would otherwise paint (and cache) Alloy's lavender
 * in the meantime.
 */
const SERVER_ACCENTS_CACHE_KEY = "alloy.server-accents"
const DARK_QUERY = "(prefers-color-scheme: dark)"
const MatchMediaSchema = t.instanceof(Function)

let preferences: ThemePreferences = DEFAULT_THEME_PREFERENCES
let customThemes: readonly CustomTheme[] = []
let serverAccents: ThemeAccents = NO_THEME_ACCENTS
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
    current.dark === synced.dark
  ) {
    return
  }
  preferences = writeThemePreferences({
    ...preferences,
    mode: synced.mode,
    light: synced.light,
    dark: synced.dark,
  })
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
  serverAccents = readServerAccentsCache()
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

/** "system" follows the OS; light and dark each show their chosen theme. */
export function setThemeMode(mode: ThemeMode): void {
  savePreferences({ ...preferences, mode })
}

/**
 * One variant takes over its appearance. The color scheme stays put: a pick
 * for the other appearance shows in the scheme previews until it's in use.
 */
export function selectThemeVariant(id: string): void {
  const variant = findVariant(state.themes, id)
  if (!variant) return
  savePreferences(withVariant(preferences, variant))
}

/** A whole theme takes over every appearance it has, scheme unchanged. */
export function selectThemeFamily(id: string): void {
  const family = state.themes.find((candidate) => candidate.id === id)
  if (!family) return

  let next = preferences
  for (const appearance of THEME_APPEARANCES) {
    const variant = themeFamilyDefault(family, appearance)
    if (variant) next = withVariant(next, variant)
  }
  savePreferences(next)
}

export function setServerThemeAccents(accents: ThemeAccents): void {
  const next = normalizeAccents(accents)
  if (sameAccents(next, serverAccents)) return
  serverAccents = next
  writeStorage(
    SERVER_ACCENTS_CACHE_KEY,
    next.light || next.dark ? JSON.stringify(next) : null,
  )
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

/**
 * Adds the theme, or replaces the stored one with the same id. An appearance
 * that used a variant the edit removed moves to the theme's first variant
 * for it, or back to Alloy.
 */
export function saveCustomTheme(theme: CustomTheme): void {
  const exists = customThemes.some((candidate) => candidate.id === theme.id)
  customThemes = writeCustomThemes(
    exists
      ? customThemes.map((candidate) =>
          candidate.id === theme.id ? theme : candidate,
        )
      : [...customThemes, theme],
  )

  const family = customThemeFamily(theme)
  const next = { ...preferences }
  let moved = false
  for (const appearance of THEME_APPEARANCES) {
    const chosen = next[appearance]
    if (
      !chosen.startsWith(`${theme.id}:`) ||
      findVariant([family], chosen, appearance)
    ) {
      continue
    }
    next[appearance] =
      themeFamilyDefault(family, appearance)?.id ??
      DEFAULT_THEME_VARIANT_IDS[appearance]
    moved = true
  }
  if (moved) savePreferences(next)
  else refresh()
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

/** The colors a variant paints with, the server's accent included. */
export function themeVariantColors(
  theme: ThemeState,
  variant: ThemeVariant,
): ThemeColors {
  const accent = serverAccentFor(theme, variant)
  return accent ? withThemeAccent(variant.colors, accent) : variant.colors
}

/** The server's accent tints Alloy's own variants and nothing else. */
function serverAccentFor(
  theme: ThemeState,
  variant: ThemeVariant,
): string | null {
  return isAlloyThemeVariant(variant.id)
    ? theme.serverAccents[variant.appearance]
    : null
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
    DEFAULT_THEME_VARIANTS[appearance]
  return {
    preferences,
    themes,
    customThemes,
    serverAccents,
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

  const bundledDefaults =
    !preview &&
    THEME_APPEARANCES.every(
      (target) =>
        state[target].id === DEFAULT_THEME_VARIANT_IDS[target] &&
        !serverAccentFor(state, state[target]),
    )
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

function readServerAccentsCache(): ThemeAccents {
  try {
    const cached = ThemeAccentsSchema.safeParse(
      JSON.parse(localStorage.getItem(SERVER_ACCENTS_CACHE_KEY) ?? "null"),
    )
    return cached.success ? cached.data : NO_THEME_ACCENTS
  } catch {
    return NO_THEME_ACCENTS
  }
}

function normalizeAccents(accents: ThemeAccents): ThemeAccents {
  return {
    light: accents.light ? normalizeThemeColor(accents.light) : null,
    dark: accents.dark ? normalizeThemeColor(accents.dark) : null,
  }
}

function sameAccents(first: ThemeAccents, second: ThemeAccents): boolean {
  return first.light === second.light && first.dark === second.dark
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

// "system" falls back to dark when matchMedia is unavailable, matching the
// pre-paint script.
function readSystemAppearance(): ThemeAppearance {
  if (!globalThis.window?.matchMedia) return "dark"
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
}
