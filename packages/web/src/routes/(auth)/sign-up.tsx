import { createFileRoute, redirect } from "@tanstack/react-router"

import { SignUpPageInner } from "@/components/routes/sign-up/sign-up-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/sign-up")({
  beforeLoad: redirectAuthedBeforeLoad,
  loader: async ({ context }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    if (config.adminAccountRequired) {
      throw redirect({ to: "/setup" })
    }
    if (config.setupRequired) {
      throw redirect({ to: "/login" })
    }
    const canSignUp =
      config.openRegistrations &&
      (config.passkeyEnabled || config.providers.length > 0)
    if (!canSignUp) {
      throw redirect({ to: "/login" })
    }
    return { config }
  },
  component: SignUpPage,
})

function SignUpPage() {
  const { config } = Route.useLoaderData()

  return <SignUpPageInner config={config} />
}
