import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"

import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
} from "@workspace/ui/components/app-header"

import { UserMenu } from "@/components/layout/user-menu"
import { SettingsLayoutInner } from "@/components/routes/settings/settings-layout-inner"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"

export const Route = createFileRoute("/(app)/_app/_settings")({
  beforeLoad: requireStrictAuthBeforeLoad,
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
