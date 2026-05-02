import { createFileRoute, redirect } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/login")({
  beforeLoad: redirectAuthedBeforeLoad,
  loader: async ({ context }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    if (config.adminAccountRequired) {
      throw redirect({ to: "/setup" })
    }
    return { config }
  },
  component: LoginPage,
})

function LoginPage() {
  const { config } = Route.useLoaderData()

  return <LoginPageInner config={config} />
}
