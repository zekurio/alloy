import { createFileRoute, redirect } from "@tanstack/react-router"

import { SignUpPageInner } from "@/components/routes/sign-up/sign-up-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { fetchPublicClips } from "@/lib/public-clips"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/sign-up")({
  beforeLoad: redirectAuthedBeforeLoad,
  loader: async ({ context }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    if (config.setupRequired) {
      throw redirect({ to: "/setup" })
    }
    const canSignUp =
      config.openRegistrations &&
      (config.passkeyEnabled || config.provider !== null)
    if (!canSignUp) {
      throw redirect({ to: "/login" })
    }
    const clips = await fetchPublicClips()
    return { clips, config }
  },
  component: SignUpPage,
})

function SignUpPage() {
  const { clips, config } = Route.useLoaderData()

  return <SignUpPageInner clips={clips} config={config} />
}
