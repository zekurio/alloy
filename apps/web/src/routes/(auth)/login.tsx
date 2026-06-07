import { createFileRoute, redirect } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { sanitizeLoginRedirect } from "@/lib/login-redirect"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/login")({
  validateSearch: (search): { redirect?: string } => {
    const target = sanitizeLoginRedirect(search.redirect)
    return target ? { redirect: target } : {}
  },
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
  const { redirect: redirectTo } = Route.useSearch()

  return <LoginPageInner config={config} redirectTo={redirectTo} />
}
