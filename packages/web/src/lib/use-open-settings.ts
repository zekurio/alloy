import { useIsMobile } from "@alloy/ui/hooks/use-mobile"
import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

import { DEFAULT_SETTINGS_SECTION } from "@/components/routes/settings/settings-categories"
import type { AppSearch } from "@/lib/app-search"

/** Opens the native settings page on mobile and the settings dialog elsewhere. */
export function useOpenSettings() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  return useCallback(() => {
    if (isMobile) {
      void navigate({ to: "/settings" })
      return
    }
    void navigate({
      to: ".",
      search: (prev: AppSearch) => ({
        ...prev,
        settings: DEFAULT_SETTINGS_SECTION,
      }),
    })
  }, [isMobile, navigate])
}
