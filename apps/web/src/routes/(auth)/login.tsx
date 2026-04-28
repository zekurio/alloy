import * as React from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { fetchPublicClips } from "@/lib/public-clips"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/login")({
  beforeLoad: redirectAuthedBeforeLoad,
  loader: async ({ context }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    if (config.adminAccountRequired) {
      throw redirect({ to: "/setup" })
    }
    const clips = fetchPublicClips()
    return { config, clips }
  },
  component: LoginPage,
})

function LoginPage() {
  const { config, clips } = Route.useLoaderData()

  return (
    <React.Suspense fallback={<LoginPageInner config={config} clips={[]} />}>
      <LoginPageLoaded config={config} clips={clips} />
    </React.Suspense>
  )
}

function LoginPageLoaded({
  config,
  clips,
}: {
  config: Awaited<ReturnType<typeof loadAuthConfig>>
  clips: ReturnType<typeof fetchPublicClips>
}) {
  const resolvedClips = React.use(clips)

  return <LoginPageInner config={config} clips={resolvedClips} />
}
