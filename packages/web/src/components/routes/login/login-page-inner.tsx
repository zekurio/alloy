import type { PublicAuthConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { Link } from "@tanstack/react-router"
import { LogInIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { SignInReactivationPrompt } from "@/components/account/reactivate-account-prompt"
import { authClient } from "@/lib/auth-client"
import { useLoginRedirect } from "@/lib/auth-hooks"
import { alloyDesktop } from "@/lib/desktop"
import { usePasskeySupport } from "@/lib/passkey-support"

import { OAuthSignIn } from "./oauth-sign-in"
import { PasskeySignIn } from "./passkey-sign-in"

type LoginPageInnerProps = {
  config: PublicAuthConfig
  redirectTo?: string
  reactivate?: boolean
}

const DESKTOP_LOGIN_ERROR_TOAST_ID = "desktop-login-error"

/**
 * Presentational sign-in card body. Renders the configured sign-in methods.
 * Shared by the real login page and the admin login-appearance preview, so it
 * must stay free of redirect/navigation side effects.
 */
export function LoginForm({
  config,
  passkeyReady = true,
  passkeySupported,
  redirectTo,
  onReactivationRequired,
}: {
  config: PublicAuthConfig
  passkeyReady?: boolean
  passkeySupported: boolean
  redirectTo?: string
  onReactivationRequired?: () => void
}) {
  const { providers, openRegistrations, passkeyEnabled } = config
  const showPasskeySignIn = passkeyReady && passkeyEnabled && passkeySupported
  const canSignUp =
    openRegistrations && (passkeyEnabled || providers.length > 0)

  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          {t("Sign in")}
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {showPasskeySignIn ? (
          <PasskeySignIn
            redirectTo={redirectTo}
            onReactivationRequired={onReactivationRequired}
          />
        ) : null}
        {providers.map((provider) => (
          <OAuthSignIn
            key={provider.providerId}
            provider={provider}
            redirectTo={redirectTo}
          />
        ))}
      </div>

      {passkeyReady && passkeyEnabled && !passkeySupported ? (
        <p className="text-foreground-muted mt-4 text-sm">
          {t(
            "Passkey sign-in is enabled, but this browser does not support passkeys.",
          )}
        </p>
      ) : null}

      {canSignUp ? (
        <p className="text-foreground-muted mt-6 text-center text-sm">
          {t("Don't have an account?")}{" "}
          <Link
            to="/sign-up"
            className="text-foreground hover:text-accent font-medium underline-offset-4 hover:underline"
          >
            {t("Create one")}
          </Link>
        </p>
      ) : null}
    </>
  )
}

export function LoginPageInner({
  config,
  redirectTo,
  reactivate = false,
}: LoginPageInnerProps) {
  const canRender = useLoginRedirect(redirectTo ?? null)
  const [reactivationRequired, setReactivationRequired] = useState(reactivate)
  const { ready: passkeyReady, supported: passkeySupported } =
    usePasskeySupport()
  const desktop = alloyDesktop()

  useEffect(() => {
    if (!desktop && config.passkeyEnabled && passkeyReady && passkeySupported) {
      authClient.signIn.preloadPasskey()
    }
  }, [config.passkeyEnabled, desktop, passkeyReady, passkeySupported])

  if (!canRender) return null

  if (desktop && !redirectTo) {
    return <DesktopLoginPage desktop={desktop} />
  }

  return (
    <>
      <LoginForm
        config={config}
        passkeyReady={passkeyReady}
        passkeySupported={passkeySupported}
        redirectTo={redirectTo}
        onReactivationRequired={() => setReactivationRequired(true)}
      />
      <SignInReactivationPrompt
        open={reactivationRequired}
        redirectTo={redirectTo}
        onDismiss={() => setReactivationRequired(false)}
      />
    </>
  )
}

function DesktopLoginPage({
  desktop,
}: {
  desktop: NonNullable<ReturnType<typeof alloyDesktop>>
}) {
  const [pending, setPending] = useState(false)

  async function onSignIn() {
    if (pending) return
    setPending(true)
    toast.dismiss(DESKTOP_LOGIN_ERROR_TOAST_ID)
    try {
      await desktop.openConnect()
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : t("Could not reach server."),
        { id: DESKTOP_LOGIN_ERROR_TOAST_ID },
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          {t("Signed out")}
        </h2>
        <p className="text-foreground-muted text-sm">
          {t("Open the connection screen to sign in with your browser.")}
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full gap-3"
        disabled={pending}
        onClick={onSignIn}
      >
        {pending ? <Spinner /> : <LogInIcon className="size-4" />}
        {t("Sign in")}
      </Button>
    </>
  )
}
