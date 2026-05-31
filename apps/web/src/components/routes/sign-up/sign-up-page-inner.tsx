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

export function SignUpPageInner({ config }: SignUpPageInnerProps) {
  const canRender = useRedirectIfAuthed("/")
  const { supported: passkeySupported, ready: passkeyReady } =
    usePasskeySupport()

  if (!canRender) return null
  if (config.passkeyEnabled && !passkeyReady) return null

  const canPasskeySignUp = config.openRegistrations && config.passkeyEnabled
  const showPasskeySignUp = canPasskeySignUp && passkeySupported
  const oauthProvider = config.openRegistrations ? config.provider : null
  const canOAuthSignUp = oauthProvider !== null
  const showSeparator = showPasskeySignUp && canOAuthSignUp

  return (
    <AuthPageFrame splash={config.loginSplash}>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Create your account
        </h2>
        <p className="text-sm text-foreground-muted">
          Choose an enabled sign-up method.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {showPasskeySignUp ? <PasskeySignUpForm /> : null}

        {canPasskeySignUp && passkeyReady && !passkeySupported ? (
          <p className="text-sm text-foreground-muted">
            Passkey sign-up is enabled, but this browser does not support
            passkeys.
          </p>
        ) : null}

        {showSeparator ? (
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs font-medium tracking-wider text-foreground-muted uppercase">
              or
            </span>
            <Separator className="flex-1" />
          </div>
        ) : null}

        {canOAuthSignUp ? (
          <OAuthSignIn
            providerId={oauthProvider.providerId}
            displayName={oauthProvider.displayName}
          />
        ) : null}
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
    </AuthPageFrame>
  )
}
