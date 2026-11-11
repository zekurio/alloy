import { t } from "@alloy/i18n"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { Button } from "@alloy/ui/components/button"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { Input } from "@alloy/ui/components/input"
import { Spinner } from "@alloy/ui/components/spinner"
import { useMutation } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router"
import { Suspense, lazy, type ReactNode, useState } from "react"

import { OAuthSignIn } from "@/components/routes/login/oauth-sign-in"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

export const Route = createFileRoute("/(auth)/setup")({
  loader: async ({ context }) => {
    const config = context.authConfig
    if (!config.setupRequired) throw redirect({ to: "/" })
    // Whether this browser still has to present the setup token is its own
    // answer, so it comes from its own request.
    return { oidc: config.oidc, status: await api.setup.fetchStatus() }
  },
  component: SetupPage,
})

const PasskeySignUpForm = lazy(() =>
  import("@/components/routes/sign-up/passkey-sign-up-form").then((m) => ({
    default: m.PasskeySignUpForm,
  })),
)

function SetupPage() {
  const { oidc, status } = Route.useLoaderData()

  return (
    <div className="bg-background text-foreground relative min-h-screen w-full">
      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <Link to="/" className="inline-flex items-center">
          <AlloyLogo showText size={36} />
        </Link>
      </header>

      <main className="relative flex min-h-screen items-center justify-center px-6 py-24 sm:px-10">
        {status.tokenRequired ? (
          <VerifyTokenStep />
        ) : status.mode === "oidc" && oidc ? (
          // The provider names the admin, so this step asks for no setup
          // token: only an identity whose role claim says admin gets in.
          <AdminAccountStep
            description={t(
              "Sign in with {provider} as an account whose {claim} claim is admin. That account becomes the admin here.",
              { provider: oidc.displayName, claim: status.roleClaim ?? "" },
            )}
          >
            <OAuthSignIn provider={oidc} redirectTo="/setup" />
          </AdminAccountStep>
        ) : status.mode === "passkey" ? (
          <AdminAccountStep
            description={t(
              "This first account will be assigned the admin role.",
            )}
          >
            <Suspense fallback={null}>
              <PasskeySignUpForm welcome={false} />
            </Suspense>
          </AdminAccountStep>
        ) : (
          <AdminAccountStep
            description={t(
              "No sign-in method is available. Turn on passkeys, or configure single sign-on with the ALLOY_OIDC_* variables, then reload this page.",
            )}
          />
        )}
      </main>
    </div>
  )
}

/**
 * The first account becomes the admin, so the browser proves it belongs to
 * whoever runs the server first.
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

function AdminAccountStep({
  description,
  children,
}: {
  description: string
  children?: ReactNode
}) {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold">
          {t("Create the admin account")}
        </h2>
        <p className="text-foreground-muted text-sm">{description}</p>
      </div>
      {children}
    </div>
  )
}
