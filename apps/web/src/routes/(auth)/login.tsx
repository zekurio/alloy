import * as React from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { LoginPageInner } from "@/components/routes/login/login-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import {
  fetchPublicClips,
  publicClipsWithLoadedThumbnails,
} from "@/lib/public-clips"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/login")({
  beforeLoad: redirectAuthedBeforeLoad,
  loader: async () => {
    const clips = fetchPublicClips()
    const config = await loadAuthConfig()
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
  const loadedClips = React.use(publicClipsWithLoadedThumbnails(resolvedClips))

  return <LoginPageInner config={config} clips={loadedClips} />
}
