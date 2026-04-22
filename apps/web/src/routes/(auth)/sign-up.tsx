import * as React from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { SignUpPageInner } from "@/components/routes/sign-up/sign-up-page-inner"
import { fetchAuthConfig } from "@/lib/auth-config"
import { fetchPublicClips } from "@/lib/public-clips"

export const Route = createFileRoute("/(auth)/sign-up")({
  loader: async () => {
    const [config, clips] = await Promise.all([
      fetchAuthConfig(),
      fetchPublicClips(),
    ])
    if (config.setupRequired) {
      throw redirect({ to: "/setup" })
    }
    if (!config.openRegistrations || !config.emailPasswordEnabled) {
      throw redirect({ to: "/login" })
    }
    return { clips }
  },
  component: SignUpPage,
})

function SignUpPage() {
  const { clips } = Route.useLoaderData()

  return (
    <React.Suspense fallback={null}>
      <SignUpPageInner clips={clips} />
    </React.Suspense>
  )
}
