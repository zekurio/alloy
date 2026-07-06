import { t } from "@alloy/i18n"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { useMutation } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { Suspense, lazy, useEffect, useRef } from "react"

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

const PasskeySignUpForm = lazy(() =>
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
          {t("Create the admin account")}
        </h2>
        <p className="text-foreground-muted text-sm">
          {t("This first account will be assigned the admin role.")}
        </p>
      </div>

      <Suspense fallback={null}>
        <PasskeySignUpForm redirectTo="/setup" />
      </Suspense>
    </div>
  )
}

function CompleteSetupStep() {
  const navigate = useNavigate()
  const hasSubmitted = useRef(false)
  const { error, mutate } = useMutation({
    mutationFn: () => api.admin.updateRuntimeConfig({ setupComplete: true }),
    onSuccess: () => {
      invalidateAuthConfig()
      void navigate({ to: "/" })
    },
  })

  useEffect(() => {
    if (hasSubmitted.current) return
    hasSubmitted.current = true
    mutate()
  }, [mutate])

  const message = error
    ? errorMessage(error, t("Couldn't complete setup"))
    : null

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold">
          {t("Finishing setup")}
        </h2>
        {message ? (
          <p className="text-destructive text-sm">{message}</p>
        ) : (
          <p className="text-foreground-muted text-sm">
            {t("Finalizing the instance state.")}
          </p>
        )}
      </div>
    </div>
  )
}
