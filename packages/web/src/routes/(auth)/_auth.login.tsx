import { createFileRoute, redirect } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { sanitizeLoginRedirect } from "@/lib/login-redirect"
import { loadAuthConfig } from "@/lib/session-suspense"

type LoginSearch = {
  redirect?: string
  reactivate?: boolean
}

export const Route = createFileRoute("/(auth)/_auth/login")({
  validateSearch: (search) => {
    const result: LoginSearch = {}
    const target = sanitizeLoginRedirect(search.redirect)
    if (target) result.redirect = target
    if (search.reactivate === true || search.reactivate === "true") {
      result.reactivate = true
    }
    return result
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
  const { reactivate, redirect: redirectTo } = Route.useSearch()

  return (
    <LoginPageInner
      config={config}
      redirectTo={redirectTo}
      reactivate={reactivate}
    />
  )
}
