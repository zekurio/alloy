import { Link } from "@tanstack/react-router"
import type { PublicAuthConfig } from "@workspace/api"
import * as React from "react"

import { AuthPageFrame } from "@/components/auth/auth-page-frame"
import { authClient } from "@/lib/auth-client"
import { useRedirectIfAuthed } from "@/lib/auth-hooks"
import { usePasskeySupport } from "@/lib/passkey-support"

import { OAuthSignIn } from "./oauth-sign-in"
import { PasskeySignIn } from "./passkey-sign-in"

type LoginPageInnerProps = {
  config: PublicAuthConfig
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
}: {
  config: PublicAuthConfig
  passkeyReady?: boolean
  passkeySupported: boolean
}) {
  const { providers, openRegistrations, passkeyEnabled } = config
  const showPasskeySignIn = passkeyReady && passkeyEnabled && passkeySupported
  const canSignUp =
    openRegistrations && (passkeyEnabled || providers.length > 0)

  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          Sign in
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {showPasskeySignIn ? <PasskeySignIn /> : null}
        {providers.map((provider) => (
          <OAuthSignIn key={provider.providerId} provider={provider} />
        ))}
      </div>

      {passkeyReady && passkeyEnabled && !passkeySupported ? (
        <p className="text-foreground-muted mt-4 text-sm">
          Passkey sign-in is enabled, but this browser does not support
          passkeys.
        </p>
      ) : null}

      {canSignUp ? (
        <p className="text-foreground-muted mt-6 text-center text-sm">
          Don't have an account?{" "}
          <Link
            to="/sign-up"
            className="text-foreground hover:text-accent font-medium underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      ) : null}
    </>
  )
}

export function LoginPageInner({ config }: LoginPageInnerProps) {
  const canRender = useRedirectIfAuthed("/")
  const { ready: passkeyReady, supported: passkeySupported } =
    usePasskeySupport()

  React.useEffect(() => {
    if (config.passkeyEnabled && passkeyReady && passkeySupported) {
      authClient.signIn.preloadPasskey()
    }
  }, [config.passkeyEnabled, passkeyReady, passkeySupported])

  if (!canRender) return null

  return (
    <AuthPageFrame splash={config.loginSplash}>
      <LoginForm
        config={config}
        passkeyReady={passkeyReady}
        passkeySupported={passkeySupported}
      />
    </AuthPageFrame>
  )
}
