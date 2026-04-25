import { createFileRoute, redirect } from "@tanstack/react-router"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"

import { PasskeySignUpForm } from "@/components/routes/sign-up/passkey-sign-up-form"
import { api } from "@/lib/api"

/**
 * First-admin bootstrap — the only public sign-up surface. The server's
 * user-create hook is the real guard; this redirect is UX.
 */
export const Route = createFileRoute("/(auth)/setup")({
  loader: async () => {
    const config = await api.authConfig.fetch()
    if (!config.setupRequired) {
      throw redirect({ to: "/login" })
    }
    return config
  },
  component: SetupPage,
})

function SetupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <AlloyLogo showText size={32} />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Create the admin account
            </h1>
            <p className="text-sm text-foreground-muted">
              You are the first user. Create your admin account with a passkey
              so you can configure OAuth providers, enable sign-up and seed new
              users.
            </p>
          </div>
        </div>

        <PasskeySignUpForm
          redirectTo="/admin-settings"
          successMessage="Admin account ready"
        />
      </div>
    </div>
  )
}
