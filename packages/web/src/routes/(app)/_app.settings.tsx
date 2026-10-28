import { createFileRoute, redirect } from "@tanstack/react-router"

import { SETTINGS_OVERVIEW_SECTION } from "@/components/routes/settings/settings-categories"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"

// Settings is a dialog over the app, opened by the `settings` search param
// (see `_app.tsx`). The address opens it over the home feed.
export const Route = createFileRoute("/(app)/_app/settings")({
  beforeLoad: ({ context }) => {
    requireStrictAuthBeforeLoad({ context })
    throw redirect({
      to: "/",
      search: { settings: SETTINGS_OVERVIEW_SECTION },
      replace: true,
    })
  },
})
