import type { PublicAuthConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Spinner } from "@alloy/ui/components/spinner"
import { Link } from "@tanstack/react-router"
import { LogInIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { authClient } from "@/lib/auth-client"
import { useLoginRedirect } from "@/lib/auth-hooks"
import { alloyDesktop } from "@/lib/desktop"
import { usePasskeySupport } from "@/lib/passkey-support"

import { OAuthSignIn } from "./oauth-sign-in"
import { PasskeySignIn } from "./passkey-sign-in"

type LoginPageInnerProps = {
  config: PublicAuthConfig
  redirectTo?: string
}

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
}: {
  config: PublicAuthConfig
  passkeyReady?: boolean
  passkeySupported: boolean
  redirectTo?: string
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
        {showPasskeySignIn ? <PasskeySignIn redirectTo={redirectTo} /> : null}
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

export function LoginPageInner({ config, redirectTo }: LoginPageInnerProps) {
  const canRender = useLoginRedirect(redirectTo ?? null)
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
    return <DesktopLoginPage />
  }

  return (
    <LoginForm
      config={config}
      passkeyReady={passkeyReady}
      passkeySupported={passkeySupported}
      redirectTo={redirectTo}
    />
  )
}

function DesktopLoginPage() {
  const desktop = alloyDesktop()
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadServer() {
      const currentServer = await desktop?.servers.getCurrentServer()
      const savedServer =
        currentServer ?? (await desktop?.servers.getServers())?.[0]?.serverUrl
      if (cancelled) return
      setServerUrl(savedServer ?? null)
      setLoaded(true)
    }

    void loadServer()

    return () => {
      cancelled = true
    }
  }, [desktop])

  async function onSignIn() {
    if (!desktop || pending) return
    if (!serverUrl) {
      await desktop.openConnect()
      return
    }

    setPending(true)
    setError(null)
    const result = await desktop.servers.connect(serverUrl)
    if (!result.ok) {
      setError(result.error)
      setPending(false)
    }
  }

  const serverLabel = serverUrl ? new URL(serverUrl).host : null

  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          {t("Signed out")}
        </h2>
        <p className="text-foreground-muted text-sm">
          {serverLabel
            ? t("Sign in to {serverLabel} in your browser to continue.", {
                serverLabel,
              })
            : loaded
              ? t("Choose an Alloy server to sign in.")
              : t("Loading saved server...")}
        </p>
      </div>
      {error ? (
        <p className="text-danger mb-3 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full gap-3"
        disabled={!loaded || pending}
        onClick={onSignIn}
      >
        {pending ? <Spinner /> : <LogInIcon className="size-4" />}
        <span className="truncate">
          {serverUrl ? t("Sign in to saved server") : t("Choose server")}
        </span>
      </Button>
    </>
  )
}
