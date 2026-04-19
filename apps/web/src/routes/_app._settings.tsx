import * as React from "react"
import { Link, Outlet, createFileRoute } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"

import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
} from "@workspace/ui/components/app-header"
import { AppMain } from "@workspace/ui/components/app-shell"

import { UserMenu } from "../components/user-menu"
import { useRequireAuth } from "../lib/auth-hooks"

/**
 * Shared layout for the settings cluster (`/user-settings`, `/admin-settings`).
 *
 * Both pages share the same chrome: the slim `AppHeader` (brand + user
 * menu, no search), the same outer `AppMain` wrapper, and the same
 * "← Back" affordance. Hoisting it here means switching between profile
 * and admin only re-renders the per-page card stack — header, sidebar
 * (from `_app`), and the auth-guard suspense boundary all stay mounted.
 *
 * The auth guard (`useRequireAuth`) lives at this layer instead of the
 * leaves so we don't double-suspend when navigating profile ↔ admin —
 * the suspense boundary higher up never tears down.
 */
export const Route = createFileRoute("/_app/_settings")({
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <React.Suspense fallback={null}>
      <SettingsLayoutInner />
    </React.Suspense>
  )
}

function SettingsLayoutInner() {
  const session = useRequireAuth()
  if (!session) return null

  return (
    <>
      <AppHeader>
        <AppHeaderBrand />
        <AppHeaderActions>
          <UserMenu />
        </AppHeaderActions>
      </AppHeader>
      <AppMain>
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <Link
            to="/"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" /> Back
          </Link>
          <Outlet />
        </div>
      </AppMain>
    </>
  )
}
