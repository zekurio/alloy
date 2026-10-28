import type { PublicAuthConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import { Separator } from "@alloy/ui/components/separator"
import { Spinner } from "@alloy/ui/components/spinner"
import { useMutation } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { Suspense, lazy, useEffect, useRef, useState } from "react"

import { OAuthSignIn } from "@/components/routes/login/oauth-sign-in"
import { api } from "@/lib/api"
import { isAdmin } from "@/lib/auth-access"
import { errorMessage } from "@/lib/error-message"
import { invalidateAuthConfig, loadSession } from "@/lib/session-suspense"

export const Route = createFileRoute("/(auth)/setup")({
  loader: async ({ context }) => {
    const config = context.authConfig
    if (config.adminAccountRequired) {
      // Whether this browser still has to present the setup token depends
      // on where it connects from, so it comes from its own request.
      return { config, status: await api.setup.fetchStatus() }
    }
    // The root guard skips the session on /setup, so load it here.
    const session = await loadSession()
    if (!session) {
      throw redirect({ to: "/login" })
    }
    if (!config.setupRequired || !isAdmin(session)) {
      throw redirect({ to: "/" })
    }
    return { config, status: null }
  },
  component: SetupPage,
})

const PasskeySignUpForm = lazy(() =>
  import("@/components/routes/sign-up/passkey-sign-up-form").then((m) => ({
    default: m.PasskeySignUpForm,
  })),
)

function SetupPage() {
  const { config, status } = Route.useLoaderData()

  return (
    <div className="bg-background text-foreground relative min-h-screen w-full">
      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <Link to="/" className="inline-flex items-center">
          <AlloyLogo showText size={36} />
        </Link>
      </header>

      <main className="relative flex min-h-screen items-center justify-center px-6 py-24 sm:px-10">
        {!status ? (
          <CompleteSetupStep />
        ) : status.tokenRequired ? (
          <VerifyTokenStep />
        ) : (
          <AdminAccountStep config={config} />
        )}
      </main>
    </div>
  )
}

/**
 * The first account becomes the admin, so a browser outside the server's
 * local network proves it belongs to whoever runs the server first.
 */
function VerifyTokenStep() {
  const router = useRouter()
  const [token, setToken] = useState("")
  const verify = useMutation({
    mutationFn: (value: string) => api.setup.verifyToken(value),
    onSuccess: () => void router.invalidate(),
  })
  const message = verify.error
    ? errorMessage(verify.error, t("Couldn't verify the setup token"))
    : null

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold">
          {t("Verify that you run this server")}
        </h2>
        <p className="text-foreground-muted text-sm">
          {t(
            "The first account becomes the admin. Enter the setup token from the server log, or the value of ALLOY_SETUP_TOKEN if you set one.",
          )}
        </p>
      </div>

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (token.trim() && !verify.isPending) verify.mutate(token.trim())
        }}
      >
        <Field>
          <FieldLabel htmlFor="setup-token" required>
            {t("Setup token")}
          </FieldLabel>
          <Input
            id="setup-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "setup-token-error" : undefined}
            disabled={verify.isPending}
            className="font-mono"
          />
          {message ? (
            <p
              id="setup-token-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {message}
            </p>
          ) : null}
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!token.trim() || verify.isPending}
        >
          {verify.isPending ? <Spinner className="size-4" /> : null}
          {t("Continue")}
        </Button>
      </form>
    </div>
  )
}

function AdminAccountStep({ config }: { config: PublicAuthConfig }) {
  const { providers, passkeyEnabled } = config

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

      <div className="flex flex-col gap-5">
        {providers.length > 0 ? (
          <div className="flex flex-col gap-3">
            {providers.map((provider) => (
              <OAuthSignIn
                key={provider.providerId}
                provider={provider}
                redirectTo="/setup"
                setup
              />
            ))}
          </div>
        ) : null}
        {providers.length > 0 && passkeyEnabled ? (
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-foreground-muted text-xs font-medium tracking-wider uppercase">
              {t("or")}
            </span>
            <Separator className="flex-1" />
          </div>
        ) : null}
        {passkeyEnabled ? (
          <Suspense fallback={null}>
            <PasskeySignUpForm redirectTo="/setup" />
          </Suspense>
        ) : null}
        {providers.length === 0 && !passkeyEnabled ? (
          <p className="text-destructive text-sm" role="alert">
            {t(
              "No sign-in method is available. Turn on passkeys, or configure single sign-on with the ALLOY_OIDC_* variables, then reload this page.",
            )}
          </p>
        ) : null}
      </div>
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
