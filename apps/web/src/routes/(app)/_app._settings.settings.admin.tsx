import { createFileRoute, redirect } from "@tanstack/react-router"

import { requireAdminBeforeLoad } from "@/lib/auth-guards"

export const Route = createFileRoute("/(app)/_app/_settings/settings/admin")({
  beforeLoad: requireAdminBeforeLoad,
  loader: () => {
    throw redirect({ to: "/user-settings", replace: true })
  },
})
