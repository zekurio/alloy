import type { PublicAuthConfig } from "@alloy/api"
import { Separator } from "@alloy/ui/components/separator"
import { Link } from "@tanstack/react-router"
import * as React from "react"

import { AuthPageFrame } from "@/components/auth/auth-page-frame"
import { OAuthSignIn } from "@/components/routes/login/oauth-sign-in"
import { authClient } from "@/lib/auth-client"
import { useRedirectIfAuthed } from "@/lib/auth-hooks"
import { usePasskeySupport } from "@/lib/passkey-support"

import { PasskeySignUpForm } from "./passkey-sign-up-form"

type SignUpPageInnerProps = {
  config: PublicAuthConfig
}

/**
 * Presentational sign-up card body. Renders the configured sign-up methods.
 * Shared by the real sign-up page and the admin login-appearance preview, so it
 * must stay free of redirect/navigation side effects.
 */
export function SignUpForm({
  config,
  passkeyReady = true,
  passkeySupported,
}: {
  config: PublicAuthConfig
  passkeyReady?: boolean
  passkeySupported: boolean
}) {
  const canPasskeySignUp = config.openRegistrations && config.passkeyEnabled
  const showPasskeySignUp = passkeyReady && canPasskeySignUp && passkeySupported
  const oauthProviders = config.openRegistrations ? config.providers : []
  const canOAuthSignUp = oauthProviders.length > 0
  const showSeparator = showPasskeySignUp && canOAuthSignUp

  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          Create your account
        </h2>
      </div>

      <div className="flex flex-col gap-5">
        {showPasskeySignUp ? (
          <div className="flex flex-col gap-3">
            <PasskeySignUpForm />
          </div>
        ) : null}

        {passkeyReady && canPasskeySignUp && !passkeySupported ? (
          <p className="text-foreground-muted text-sm">
            Passkey sign-up is enabled, but this browser does not support
            passkeys.
          </p>
        ) : null}

        {showSeparator ? (
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-foreground-muted text-xs font-medium tracking-wider uppercase">
              or
            </span>
            <Separator className="flex-1" />
          </div>
        ) : null}

        {canOAuthSignUp ? (
          <div className="flex flex-col gap-3">
            {oauthProviders.map((provider) => (
              <OAuthSignIn key={provider.providerId} provider={provider} />
            ))}
          </div>
        ) : null}
      </div>

      <p className="text-foreground-muted mt-6 text-sm">
        Already have an account?{" "}
        <Link
          to="/login"
          className="text-foreground hover:text-accent font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  )
}

export function SignUpPageInner({ config }: SignUpPageInnerProps) {
  const canRender = useRedirectIfAuthed("/")
  const { supported: passkeySupported, ready: passkeyReady } =
    usePasskeySupport()

  React.useEffect(() => {
    if (config.passkeyEnabled && passkeyReady && passkeySupported) {
      authClient.passkey.preload()
    }
  }, [config.passkeyEnabled, passkeyReady, passkeySupported])

  if (!canRender) return null

  return (
    <AuthPageFrame splash={config.loginSplash}>
      <SignUpForm
        config={config}
        passkeyReady={passkeyReady}
        passkeySupported={passkeySupported}
      />
    </AuthPageFrame>
  )
}
