import * as React from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"

import { LoginArtwork } from "@/components/auth/login-artwork"
import { PasskeySignUpForm } from "@/components/routes/sign-up/passkey-sign-up-form"
import { fetchPublicClips } from "@/lib/public-clips"
import type { PublicClip } from "@/lib/public-clips"
import { loadAuthConfig } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/setup")({
  loader: async ({ context }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    if (!config.setupRequired) {
      throw redirect({ to: "/login" })
    }
    const clips = fetchPublicClips()
    return { config, clips }
  },
  component: SetupPage,
})

function SetupPage() {
  const { clips } = Route.useLoaderData()
  return (
    <React.Suspense fallback={<SetupPageInner clips={[]} />}>
      <SetupPageLoaded clips={clips} />
    </React.Suspense>
  )
}

function SetupPageLoaded({
  clips,
}: {
  clips: ReturnType<typeof fetchPublicClips>
}) {
  const resolvedClips = React.use(clips)
  return <SetupPageInner clips={resolvedClips} />
}

function SetupPageInner({ clips }: { clips: PublicClip[] }) {
  return (
    <div className="relative min-h-screen w-full bg-background text-foreground">
      <div className="absolute inset-0 overflow-hidden">
        <LoginArtwork clips={clips} />
      </div>

      <div className="relative grid min-h-screen lg:grid-cols-[1fr_minmax(480px,0.7fr)]">
        <div className="hidden lg:block" />

        <div className="relative flex min-h-screen flex-col bg-background/85 px-6 py-8 backdrop-blur-md sm:px-10 lg:bg-background lg:backdrop-blur-none">
          <header className="flex items-center">
            <Link to="/" className="inline-flex items-center">
              <AlloyLogo showText size={36} />
            </Link>
          </header>

          <div className="flex flex-1 items-center">
            <div className="w-full max-w-sm">
              <div className="mb-8 space-y-1.5">
                <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                  Create the admin account
                </h2>
                <p className="text-sm text-foreground-muted">
                  Since you are the first user, you are assigned the admin role.
                  Please check the admin settings after signing up.
                </p>
              </div>

              <PasskeySignUpForm
                redirectTo="/user-settings"
                successMessage="Admin account ready"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
