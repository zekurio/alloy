import { createFileRoute } from "@tanstack/react-router"

import { SettingsPage } from "@/components/routes/settings/settings-dialog"
import { requireStrictAuthBeforeLoad } from "@/lib/auth-guards"

export const Route = createFileRoute("/(app)/_app/settings")({
  beforeLoad: requireStrictAuthBeforeLoad,
  component: SettingsPage,
})
