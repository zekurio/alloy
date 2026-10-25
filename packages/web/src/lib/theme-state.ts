import {
  getThemeState,
  subscribeTheme,
  type ThemeState,
} from "@alloy/ui/lib/theme"
import { useSyncExternalStore } from "react"

/** The live theme, re-rendering on changes from this tab, others, and the OS. */
export function useThemeState(): ThemeState {
  return useSyncExternalStore(subscribeTheme, getThemeState, getThemeState)
}
