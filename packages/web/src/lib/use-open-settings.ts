import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

import {
  SETTINGS_OVERVIEW,
  settingsOverPage,
  type SettingsPage,
} from "@/lib/settings-location"

/** Opens the responsive settings dialog over the current route. */
export function useOpenSettings(page: SettingsPage = SETTINGS_OVERVIEW) {
  const navigate = useNavigate()
  return useCallback(() => {
    void navigate(settingsOverPage(page))
  }, [navigate, page])
}
