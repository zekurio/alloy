import { Link } from "@tanstack/react-router"

import type { PublicAuthConfig } from "@workspace/api"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import { cn } from "@workspace/ui/lib/utils"

import {
  hasLoginArtworkClips,
  LoginArtwork,
} from "@/components/auth/login-artwork"
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
  const showArtwork = hasLoginArtworkClips(clips)

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground">
      {showArtwork ? (
        <div className="absolute inset-0 overflow-hidden">
          <LoginArtwork clips={clips} />
        </div>
      ) : null}

      <div
        className={cn(
          "relative flex min-h-screen w-full",
          showArtwork
            ? "items-center justify-center lg:justify-end"
            : "items-center justify-center"
        )}
      >
        <div
          className={cn(
            "relative flex min-h-screen w-full flex-col px-6 py-8 sm:px-10",
            showArtwork
              ? "max-w-none bg-background/85 backdrop-blur-md lg:max-w-[432px]"
              : "max-w-md"
          )}
        >
          <header className="absolute top-8 left-6 flex items-center sm:left-10">
            <Link to="/" className="inline-flex items-center">
              <AlloyLogo showText size={36} />
            </Link>
          </header>

          <div className="flex flex-1 items-center justify-center py-24">
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
                    Passkey sign-up is enabled, but this browser does not
                    support passkeys.
                  </p>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
