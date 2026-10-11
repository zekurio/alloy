import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

import { SETTINGS_OVERVIEW_SECTION } from "@/components/routes/settings/settings-categories"
import type { SettingsCategoryId } from "@/components/routes/settings/settings-search"
import type { AppSearch } from "@/lib/app-search"

/** Opens the responsive settings dialog over the current route. */
export function useOpenSettings(
  section:
    | SettingsCategoryId
    | typeof SETTINGS_OVERVIEW_SECTION = SETTINGS_OVERVIEW_SECTION,
) {
  const navigate = useNavigate()
  return useCallback(() => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        settings: section,
      }),
      resetScroll: false,
    })
  }, [navigate, section])
}
