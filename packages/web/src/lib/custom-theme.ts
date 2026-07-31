import {
  applyCustomTheme,
  CUSTOM_CSS_ENABLED_STORAGE_KEY,
  CUSTOM_CSS_STORAGE_KEY,
  type CustomThemeState,
  readCustomTheme,
  SERVER_THEME_ENABLED_STORAGE_KEY,
  writeCustomTheme,
} from "@alloy/ui/lib/custom-theme"
import { useCallback, useEffect, useState } from "react"

import { subscribeRuntimeConfigUpdates } from "@/lib/runtime-config-events"
import { loadAuthConfig } from "@/lib/session-suspense"

/**
 * The instance's CSS as delivered by the server, cached at module scope so the
 * applier can rewrite both layers together without the caller having to hold
 * the auth config.
 */
let instanceCss = ""
let state = readCustomTheme()
const subscribers = new Set<(next: CustomThemeState) => void>()

const THEME_STORAGE_KEYS: readonly string[] = [
  CUSTOM_CSS_STORAGE_KEY,
  CUSTOM_CSS_ENABLED_STORAGE_KEY,
  SERVER_THEME_ENABLED_STORAGE_KEY,
]

/**
 * Applies this browser's stored CSS immediately, then the instance's once the
 * auth config resolves. `loadAuthConfig` shares its cache with the rest of the
 * app, so this rides along with the boot snapshot rather than adding a fetch.
 * Stays live afterwards: an admin saving the instance CSS re-fetches it, and a
 * theme edit in another tab re-applies here via the `storage` event.
 */
export function initCustomTheme(): void {
  applyCustomTheme(instanceCss, state)
  refreshInstanceCss()

  // Admin saves publish `authConfigChanged` after invalidating the cached auth
  // config, so re-reading it here picks up the freshly saved instance CSS.
  subscribeRuntimeConfigUpdates((event) => {
    if (event.authConfigChanged) refreshInstanceCss()
  })

  if (typeof window === "undefined") return
  window.addEventListener("storage", (event) => {
    // A null key means the whole store was cleared, which includes the theme.
    if (event.key !== null && !THEME_STORAGE_KEYS.includes(event.key)) return
    state = readCustomTheme()
    applyCustomTheme(instanceCss, state)
    for (const subscriber of subscribers) subscriber(state)
  })
}

function refreshInstanceCss(): void {
  void loadAuthConfig()
    .then((config) => {
      instanceCss = config.appearance?.customCss ?? ""
      applyCustomTheme(instanceCss, state)
    })
    .catch(() => {
      // A failed config load keeps the current instance layer; the browser's
      // own CSS is already applied and the app surfaces the error elsewhere.
    })
}

export function setCustomTheme(next: CustomThemeState): void {
  state = next
  writeCustomTheme(next)
  applyCustomTheme(instanceCss, next)
  for (const subscriber of subscribers) subscriber(next)
}

/** Live view of this browser's theme, for the settings panel. */
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
