import {
  applyCustomTheme,
  type CustomThemeState,
  readCustomTheme,
  SERVER_THEME_ENABLED_STORAGE_KEY,
  writeCustomTheme,
} from "@alloy/ui/lib/custom-theme"
import { applyStoredThemeCustomization } from "@alloy/ui/lib/theme-customization"
import { useCallback, useEffect, useState } from "react"

import { subscribeRuntimeConfigUpdates } from "@/lib/runtime-config-events"
import { loadAuthConfig } from "@/lib/session-suspense"

/** The instance CSS cached outside React so settings can toggle it instantly. */
let instanceCss = ""
let state = readCustomTheme()
const subscribers = new Set<(next: CustomThemeState) => void>()

const THEME_STORAGE_KEYS: readonly string[] = [SERVER_THEME_ENABLED_STORAGE_KEY]

/**
 * Applies the instance-theme preference immediately, then loads the CSS from
 * the shared auth-config snapshot. Personal structured colors are always moved
 * after that layer so an administrator cannot overwrite a browser override.
 */
export function initCustomTheme(): void {
  applyCustomTheme(instanceCss, state)
  applyStoredThemeCustomization()
  refreshInstanceCss()

  // Admin saves publish `authConfigChanged` after invalidating the cached auth
  // config, so re-reading it here picks up the freshly saved instance CSS.
  subscribeRuntimeConfigUpdates((event) => {
    if (event.authConfigChanged) refreshInstanceCss()
  })

  if (!globalThis.window) return
  window.addEventListener("storage", (event) => {
    // A null key means the whole store was cleared, which includes the theme.
    if (event.key !== null && !THEME_STORAGE_KEYS.includes(event.key)) return
    state = readCustomTheme()
    applyCustomTheme(instanceCss, state)
    applyStoredThemeCustomization()
    for (const subscriber of subscribers) subscriber(state)
  })
}

function refreshInstanceCss(): void {
  void loadAuthConfig()
    .then((config) => {
      instanceCss = config.appearance?.customCss ?? ""
      applyCustomTheme(instanceCss, state)
      applyStoredThemeCustomization()
    })
    .catch(() => {
      // A failed config load keeps the current instance layer; the app
      // surfaces the config error elsewhere.
    })
}

export function setCustomTheme(next: CustomThemeState): void {
  state = next
  writeCustomTheme(next)
  applyCustomTheme(instanceCss, next)
  applyStoredThemeCustomization()
  for (const subscriber of subscribers) subscriber(next)
}

/** Live view of this browser's instance-theme preference. */
export function useCustomTheme(): CustomThemeState {
  const [current, setCurrent] = useState(state)

  useEffect(() => {
    subscribers.add(setCurrent)
    // Another tab or an earlier mount may have moved it since first render.
    setCurrent(state)
    return () => {
      subscribers.delete(setCurrent)
    }
  }, [])

  return current
}

export function useCustomThemeEditor() {
  const theme = useCustomTheme()
  const update = useCallback((patch: Partial<CustomThemeState>) => {
    setCustomTheme({ ...state, ...patch })
  }, [])
  return { theme, update }
}
