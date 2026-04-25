import * as React from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"

import { SignUpPageInner } from "@/components/routes/sign-up/sign-up-page-inner"
import { redirectAuthedBeforeLoad } from "@/lib/auth-guards"
import { fetchPublicClips } from "@/lib/public-clips"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/sign-up")({
  beforeLoad: redirectAuthedBeforeLoad,
  loader: async () => {
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
    const clips = fetchPublicClips()
    return { clips, config }
  },
  component: SignUpPage,
})

function SignUpPage() {
  const { clips, config } = Route.useLoaderData()

  return (
    <React.Suspense fallback={<SignUpPageInner clips={[]} config={config} />}>
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

  return <SignUpPageInner clips={resolvedClips} config={config} />
}
