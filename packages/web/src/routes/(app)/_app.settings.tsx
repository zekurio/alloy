import { createFileRoute, redirect } from "@tanstack/react-router"

import { DEFAULT_SETTINGS_SECTION } from "@/components/routes/settings/settings-categories"

// The settings page is now an overlay dialog opened via the `settings` search
// param (see `_app.tsx`). Keep `/settings` working for old links/bookmarks by
// redirecting to the app root with the dialog open.
export const Route = createFileRoute("/(app)/_app/settings")({
  beforeLoad: () => {
    throw redirect({
      to: "/",
      search: { settings: DEFAULT_SETTINGS_SECTION },
    })
  },
})
