import * as React from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { SignUpPageInner } from "@/components/routes/sign-up/sign-up-page-inner"
import { api } from "@/lib/api"
import { fetchPublicClips } from "@/lib/public-clips"

export const Route = createFileRoute("/(auth)/sign-up")({
  loader: async () => {
    const [config, clips] = await Promise.all([
      api.authConfig.fetch(),
      fetchPublicClips(),
    ])
    if (config.setupRequired) {
      throw redirect({ to: "/setup" })
    }
    const canSignUp =
      config.openRegistrations &&
      (config.emailPasswordEnabled ||
        config.passkeyEnabled ||
        config.provider !== null)
    if (!canSignUp) {
      throw redirect({ to: "/login" })
    }
    return { clips, config }
  },
  component: SignUpPage,
})

function SignUpPage() {
  const { clips, config } = Route.useLoaderData()

  return (
    <React.Suspense fallback={null}>
      <SignUpPageInner clips={clips} config={config} />
    </React.Suspense>
  )
}
