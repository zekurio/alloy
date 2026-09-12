import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

import { DEFAULT_SETTINGS_SECTION } from "@/components/routes/settings/settings-categories"
import type { AppSearch } from "@/lib/app-search"

/** Opens the responsive settings dialog over the current route. */
export function useOpenSettings() {
  const navigate = useNavigate()
  return useCallback(() => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        settings: DEFAULT_SETTINGS_SECTION,
      }),
    })
  }, [navigate])
}
