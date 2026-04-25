import { Link } from "@tanstack/react-router"

import type { PublicAuthConfig } from "@workspace/api"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"

import { LoginArtwork } from "@/components/auth/login-artwork"
import { useRedirectIfAuthed } from "@/lib/auth-hooks"
import { usePasskeySupport } from "@/lib/passkey-support"
import type { fetchPublicClips } from "@/lib/public-clips"
import { OAuthSignIn } from "../login/oauth-sign-in"

import { PasskeySignUpForm } from "./passkey-sign-up-form"

type PublicClips = Awaited<ReturnType<typeof fetchPublicClips>>

type SignUpPageInnerProps = {
  clips: PublicClips
  config: PublicAuthConfig
}

export function SignUpPageInner({ clips, config }: SignUpPageInnerProps) {
  const canRender = useRedirectIfAuthed("/")
  const { supported: passkeySupported, ready: passkeyReady } =
    usePasskeySupport()

  if (!canRender) return null
  if (config.passkeyEnabled && !passkeyReady) return null

  const canPasskeySignUp = config.openRegistrations && config.passkeyEnabled
  const showPasskeySignUp = canPasskeySignUp && passkeySupported
  const oauthProvider = config.openRegistrations ? config.provider : null
  const canOAuthSignUp = oauthProvider !== null

  return (
    <div className="relative grid min-h-screen w-full bg-background text-foreground lg:grid-cols-[1fr_minmax(480px,0.7fr)]">
      <div className="relative hidden overflow-hidden lg:block">
        <LoginArtwork clips={clips} />
      </div>

      <div className="relative flex min-h-screen flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center">
          <Link to="/" className="inline-flex items-center">
            <AlloyLogo showText size={36} />
          </Link>
        </header>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
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

              {canOAuthSignUp ? (
                <OAuthSignIn
                  providerId={oauthProvider.providerId}
                  displayName={oauthProvider.displayName}
                />
              ) : null}
            </div>

            <p className="mt-6 text-center text-sm text-foreground-muted">
              Already have an account?{" "}
              <Link
                to="/login"
                className="font-medium text-foreground underline-offset-4 hover:text-accent hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
