import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { toast } from "@alloy/ui/lib/toast"
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import * as React from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import {
  invalidateAuthConfig,
  loadAuthConfig,
  loadSession,
} from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/setup")({
  loader: async ({ context }) => {
    const config = context.authConfig ?? (await loadAuthConfig())
    const session = config.adminAccountRequired
      ? null
      : (context.session ?? (await loadSession()))
    const role = (session?.user as { role?: string } | undefined)?.role
    if (!config.adminAccountRequired && !session) {
      throw redirect({ to: "/login" })
    }
    if (!config.adminAccountRequired && !config.setupRequired) {
      throw redirect({ to: "/" })
    }
    if (!config.adminAccountRequired && role !== "admin") {
      throw redirect({ to: "/" })
    }
    return { config }
  },
  component: SetupPage,
})

const PasskeySignUpForm = React.lazy(() =>
  import("@/components/routes/sign-up/passkey-sign-up-form").then((m) => ({
    default: m.PasskeySignUpForm,
  })),
)

function SetupPage() {
  const { config } = Route.useLoaderData()

  return (
    <div className="bg-background text-foreground relative min-h-screen w-full">
      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <Link to="/" className="inline-flex items-center">
          <AlloyLogo showText size={36} />
        </Link>
      </header>

      <main className="relative flex min-h-screen items-center justify-center px-6 py-24 sm:px-10">
        {config.adminAccountRequired ? (
          <AdminAccountStep />
        ) : (
          <CompleteSetupStep />
        )}
      </main>
    </div>
  )
}

function AdminAccountStep() {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold">
          Create the admin account
        </h2>
        <p className="text-foreground-muted text-sm">
          This first account will be assigned the admin role.
        </p>
      </div>

      <React.Suspense fallback={null}>
        <PasskeySignUpForm
          redirectTo="/setup"
          successMessage="Admin account ready"
        />
      </React.Suspense>
    </div>
  )
}

function CompleteSetupStep() {
  const navigate = useNavigate()
  const [message, setMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function completeSetup() {
      try {
        await api.admin.updateRuntimeConfig({ setupComplete: true })
        invalidateAuthConfig()
        toast.success("Setup complete")
        if (!cancelled) void navigate({ to: "/" })
      } catch (cause) {
        if (!cancelled) {
          setMessage(errorMessage(cause, "Couldn't complete setup"))
        }
      }
    }
    void completeSetup()
    return () => {
      cancelled = true
    }
  }, [navigate])

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold">
          Finishing setup
        </h2>
        {message ? (
          <p className="text-destructive text-sm">{message}</p>
        ) : (
          <p className="text-foreground-muted text-sm">
            Finalizing the instance state.
          </p>
        )}
      </div>
    </div>
  )
}
