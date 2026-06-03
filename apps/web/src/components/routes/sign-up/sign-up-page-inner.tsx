import { Link } from "@tanstack/react-router"

import type { PublicAuthConfig } from "@workspace/api"

import { Separator } from "@workspace/ui/components/separator"

import { AuthPageFrame } from "@/components/auth/auth-page-frame"
import { useRedirectIfAuthed } from "@/lib/auth-hooks"
import { usePasskeySupport } from "@/lib/passkey-support"
import { OAuthSignIn } from "../login/oauth-sign-in"

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
  passkeySupported,
}: {
  config: PublicAuthConfig
  passkeySupported: boolean
}) {
  const canPasskeySignUp = config.openRegistrations && config.passkeyEnabled
  const showPasskeySignUp = canPasskeySignUp && passkeySupported
  const oauthProviders = config.openRegistrations ? config.providers : []
  const canOAuthSignUp = oauthProviders.length > 0
  const showSeparator = showPasskeySignUp && canOAuthSignUp

  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Create your account
        </h2>
      </div>

      <div className="flex flex-col gap-5">
        {showPasskeySignUp
          ? (
            <div className="flex flex-col gap-3">
              <PasskeySignUpForm />
            </div>
          )
          : null}

        {canPasskeySignUp && !passkeySupported
          ? (
            <p className="text-sm text-foreground-muted">
              Passkey sign-up is enabled, but this browser does not support
              passkeys.
            </p>
          )
          : null}

        {showSeparator
          ? (
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs font-medium tracking-wider text-foreground-muted uppercase">
                or
              </span>
              <Separator className="flex-1" />
            </div>
          )
          : null}

        {canOAuthSignUp
          ? (
            <div className="flex flex-col gap-3">
              {oauthProviders.map((provider) => (
                <OAuthSignIn key={provider.providerId} provider={provider} />
              ))}
            </div>
          )
          : null}
      </div>

      <p className="mt-6 text-sm text-foreground-muted">
        Already have an account?{" "}
        <Link
          to="/login"
          className="font-medium text-foreground underline-offset-4 hover:text-accent hover:underline"
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

  if (!canRender) return null
  if (config.passkeyEnabled && !passkeyReady) return null

  return (
    <AuthPageFrame splash={config.loginSplash}>
      <SignUpForm config={config} passkeySupported={passkeySupported} />
    </AuthPageFrame>
  )
}
