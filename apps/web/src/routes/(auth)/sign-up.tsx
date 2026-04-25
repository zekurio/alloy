import * as React from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { SignUpPageInner } from "@/components/routes/sign-up/sign-up-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import {
  fetchPublicClips,
  publicClipsWithLoadedThumbnails,
} from "@/lib/public-clips"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/sign-up")({
  beforeLoad: redirectAuthedBeforeLoad,
  loader: async () => {
    const clips = fetchPublicClips()
    const config = await loadAuthConfig()
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
      <SignUpPageLoaded clips={clips} config={config} />
    </React.Suspense>
  )
}

function SignUpPageLoaded({
  clips,
  config,
}: {
  clips: ReturnType<typeof fetchPublicClips>
  config: Awaited<ReturnType<typeof loadAuthConfig>>
}) {
  const resolvedClips = React.use(clips)
  const loadedClips = React.use(publicClipsWithLoadedThumbnails(resolvedClips))

  return <SignUpPageInner clips={loadedClips} config={config} />
}
