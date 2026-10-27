import { createFileRoute, redirect } from "@tanstack/react-router"

import { SignUpPageInner } from "@/components/routes/sign-up/sign-up-page-inner"
import { canSignUp } from "@/lib/auth-access"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { isNativeDesktop } from "@/lib/desktop"

export const Route = createFileRoute("/(auth)/_auth/sign-up")({
  beforeLoad: redirectAuthedBeforeLoad,
  loader: ({ context }) => {
    if (isNativeDesktop()) throw redirect({ to: "/login" })

    const config = context.authConfig
    if (config.setupRequired) {
      throw redirect({ to: "/login" })
    }
    if (!canSignUp(config)) {
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
