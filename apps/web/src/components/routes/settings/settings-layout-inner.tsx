import { Outlet } from "@tanstack/react-router"

import { AppMain } from "@workspace/ui/components/app-shell"

import { useRequireAuth } from "../../../lib/auth-hooks"

export function SettingsLayoutInner() {
  const session = useRequireAuth()
  if (!session) return null

  return (
    <AppMain>
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <Outlet />
      </div>
    </AppMain>
  )
}
