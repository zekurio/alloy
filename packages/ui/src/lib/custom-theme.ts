import { INSTANCE_THEME_STYLE_ID } from "@alloy/ui/lib/theme-style"

export const SERVER_THEME_ENABLED_STORAGE_KEY = "alloy.serverThemeEnabled"
export const LEGACY_CUSTOM_CSS_STORAGE_KEY = "alloy.customCss"
const LEGACY_CUSTOM_CSS_ENABLED_STORAGE_KEY = "alloy.customCssEnabled"

export interface CustomThemeState {
  /** When false the instance's own theme is skipped for this browser. */
  serverThemeEnabled: boolean
}

export const DEFAULT_CUSTOM_THEME: CustomThemeState = {
  serverThemeEnabled: true,
}

export function readLegacyCustomCss(): string {
  if (!globalThis.window) return ""
  try {
    return window.localStorage.getItem(LEGACY_CUSTOM_CSS_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

export function clearLegacyCustomCss(): void {
  if (!globalThis.window) return
  try {
    window.localStorage.removeItem(LEGACY_CUSTOM_CSS_STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_CUSTOM_CSS_ENABLED_STORAGE_KEY)
  } catch {
    // Best effort: legacy CSS is never applied by the structured theme engine.
  }
}

export function readCustomTheme(): CustomThemeState {
  if (!globalThis.window) return DEFAULT_CUSTOM_THEME

  try {
    return {
      serverThemeEnabled:
        window.localStorage.getItem(SERVER_THEME_ENABLED_STORAGE_KEY) !==
        "false",
    }
  } catch {
    return DEFAULT_CUSTOM_THEME
  }
}

export function writeCustomTheme(state: CustomThemeState): void {
  if (!globalThis.window) return
  try {
    window.localStorage.setItem(
      SERVER_THEME_ENABLED_STORAGE_KEY,
      state.serverThemeEnabled ? "true" : "false",
    )
  } catch {
    // Best effort: the applied instance theme still holds for this session.
  }
}

export function applyCustomTheme(
  serverCss: string,
  state: CustomThemeState,
): void {
  if (!globalThis.document) return

  const css = state.serverThemeEnabled ? serverCss.trim() : ""
  const existing = document.getElementById(INSTANCE_THEME_STYLE_ID)
  if (!css) {
    existing?.remove()
    return
  }

  const style =
    existing instanceof HTMLStyleElement
      ? existing
      : document.createElement("style")
  style.id = INSTANCE_THEME_STYLE_ID
  if (style.textContent !== css) style.textContent = css
  if (!style.isConnected) document.head.append(style)
}
