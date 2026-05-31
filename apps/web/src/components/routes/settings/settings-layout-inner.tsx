import { Outlet } from "@tanstack/react-router"

import { AppMain } from "@workspace/ui/components/app-shell"

import { useRequireAuthStrict } from "@/lib/auth-hooks"

export function SettingsLayoutInner() {
  const session = useRequireAuthStrict()
  if (!session) return null

  return (
    <AppMain>
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <Outlet />
      </div>
    </AppMain>
  )
}
