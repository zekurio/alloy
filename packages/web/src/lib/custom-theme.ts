import {
  applyCustomTheme,
  type CustomThemeState,
  readCustomTheme,
  writeCustomTheme,
} from "@alloy/ui/lib/custom-theme"
import { useCallback, useEffect, useState } from "react"

import { loadAuthConfig } from "@/lib/session-suspense"

/**
 * The instance's CSS as delivered by the server, cached at module scope so the
 * applier can rewrite both layers together without the caller having to hold
 * the auth config.
 */
let instanceCss = ""
let state = readCustomTheme()
const subscribers = new Set<(next: CustomThemeState) => void>()

/**
 * Applies this browser's stored CSS immediately, then the instance's once the
 * auth config resolves. `loadAuthConfig` shares its cache with the rest of the
 * app, so this rides along with the boot snapshot rather than adding a fetch.
 */
export function initCustomTheme(): void {
  applyCustomTheme(instanceCss, state)
  void loadAuthConfig()
    .then((config) => {
      instanceCss = config.appearance?.customCss ?? ""
      applyCustomTheme(instanceCss, state)
    })
    .catch(() => {
      // A failed config load leaves the instance layer empty; the browser's own
      // CSS is already applied and the app surfaces the error elsewhere.
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
