import * as React from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { api } from "@/lib/api"
import { fetchPublicClips } from "@/lib/public-clips"

export const Route = createFileRoute("/(auth)/login")({
  loader: async () => {
    // `fetchPublicClips` is soft-failing, so this Promise.all can't reject
    // on its behalf.
    const [config, clips] = await Promise.all([
      api.authConfig.fetch(),
      fetchPublicClips(),
    ])
    if (config.setupRequired) {
      throw redirect({ to: "/setup" })
    }
    return { config, clips }
  },
  component: LoginPage,
})

function LoginPage() {
  const { config, clips } = Route.useLoaderData()

  return (
    <React.Suspense fallback={null}>
      <LoginPageInner config={config} clips={clips} />
    </React.Suspense>
  )
}
