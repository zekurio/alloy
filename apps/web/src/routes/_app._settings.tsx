import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
} from "@workspace/ui/components/app-header"

import { UserMenu } from "../components/user-menu"
import { SettingsLayoutInner } from "../components/routes/settings/settings-layout-inner"

/**
 * Shared layout for the settings cluster (`/user-settings`, `/admin-settings`).
 *
 * Both pages share the same chrome: the slim `AppHeader` (brand + user
 * menu, no search), the same outer `AppMain` wrapper, and the same
 * "← Back" affordance. Hoisting it here means switching between profile
 * and admin only re-renders the per-page card stack — header, sidebar
 * (from `_app`), and the auth-guard suspense boundary all stay mounted.
 *
 * The auth guard still lives at this layer, but only gates `AppMain` now;
 * the slim header stays mounted with the sidebar so the chrome doesn't
 * stream in separately from the settings content.
 */
export const Route = createFileRoute("/_app/_settings")({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <>
      <AppHeader>
        <AppHeaderBrand />
        <AppHeaderActions>
          <UserMenu />
        </AppHeaderActions>
      </AppHeader>
      <React.Suspense fallback={null}>
        <SettingsLayoutInner />
      </React.Suspense>
    </>
  )
}
