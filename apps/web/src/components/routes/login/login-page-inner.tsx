import { Link } from "@tanstack/react-router"

import type { PublicAuthConfig } from "@workspace/api"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import { FieldSeparator } from "@workspace/ui/components/field"

import { LoginArtwork } from "@/components/auth/login-artwork"
import { useRedirectIfAuthed } from "@/lib/auth-hooks"
import type { fetchPublicClips } from "@/lib/public-clips"

import { EmailPasswordForm } from "./email-password-form"
import { OAuthSignIn } from "./oauth-sign-in"
import { PasskeySignIn } from "./passkey-sign-in"

type PublicClips = Awaited<ReturnType<typeof fetchPublicClips>>

type LoginPageInnerProps = {
  config: PublicAuthConfig
  clips: PublicClips
}

export function LoginPageInner({ config, clips }: LoginPageInnerProps) {
  const canRender = useRedirectIfAuthed("/")
  if (!canRender) return null

  const { provider, emailPasswordEnabled, openRegistrations } = config
  const canSignUp = emailPasswordEnabled && openRegistrations

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
                Sign in
              </h2>
            </div>

            {emailPasswordEnabled ? <EmailPasswordForm /> : null}

            {emailPasswordEnabled ? (
              <div className="my-6">
                <FieldSeparator>OR</FieldSeparator>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              <PasskeySignIn />
              {provider ? (
                <OAuthSignIn
                  providerId={provider.providerId}
                  displayName={provider.displayName}
                />
              ) : null}
            </div>

            {canSignUp ? (
              <p className="mt-6 text-center text-sm text-foreground-muted">
                Don't have an account?{" "}
                <Link
                  to="/sign-up"
                  className="font-medium text-foreground underline-offset-4 hover:text-accent hover:underline"
                >
                  Create one
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
