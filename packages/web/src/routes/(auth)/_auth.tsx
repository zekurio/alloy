import { createFileRoute, Outlet } from "@tanstack/react-router"

import { AuthPageFrame } from "@/components/auth/auth-page-frame"
import { useSuspenseAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/_auth")({
  component: AuthLayout,
})

function AuthLayout() {
  const config = useSuspenseAuthConfig()

  return (
    <AuthPageFrame splash={config.loginSplash}>
      <Outlet />
    </AuthPageFrame>
  )
}
