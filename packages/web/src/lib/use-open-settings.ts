import { useNavigate } from "@tanstack/react-router"
import * as React from "react"

import { DEFAULT_SETTINGS_SECTION } from "@/components/routes/settings/settings-categories"
import type { AppSearch } from "@/lib/app-search"

/** Opens the settings overlay at its default section via a search-param nav. */
export function useOpenSettings() {
  const navigate = useNavigate()
  return React.useCallback(() => {
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        settings: DEFAULT_SETTINGS_SECTION,
      }),
    })
  }, [navigate])
}
