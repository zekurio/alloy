import { createFileRoute, redirect } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { fetchPublicClips } from "@/lib/public-clips"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/login")({
  beforeLoad: redirectAuthedBeforeLoad,
  loader: async ({ context }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    if (config.setupRequired) {
      throw redirect({ to: "/setup" })
    }
    const clips = await fetchPublicClips()
    return { config, clips }
  },
  component: LoginPage,
})

function LoginPage() {
  const { config, clips } = Route.useLoaderData()

  return <LoginPageInner config={config} clips={clips} />
}
