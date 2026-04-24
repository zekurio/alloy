import { createFileRoute } from "@tanstack/react-router"

import { SettingsLayoutInner } from "@/components/routes/settings/settings-layout-inner"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"

export const Route = createFileRoute("/(app)/_app/_settings")({
  beforeLoad: requireStrictAuthBeforeLoad,
  component: SettingsLayout,
})

function SettingsLayout() {
  return <SettingsLayoutInner />
}
