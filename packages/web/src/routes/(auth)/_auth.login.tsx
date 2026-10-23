import { createFileRoute } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { sanitizeLoginRedirect } from "@/lib/login-redirect"

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
  loader: ({ context }) => ({ config: context.authConfig }),
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
