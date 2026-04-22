import { Link } from "@tanstack/react-router"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"

import { LoginArtwork } from "@/components/auth/login-artwork"
import { useRedirectIfAuthed } from "@/lib/auth-hooks"
import type { fetchPublicClips } from "@/lib/public-clips"

import { SignUpForm } from "./sign-up-form"

type PublicClips = Awaited<ReturnType<typeof fetchPublicClips>>

type SignUpPageInnerProps = {
  clips: PublicClips
}

export function SignUpPageInner({ clips }: SignUpPageInnerProps) {
  const canRender = useRedirectIfAuthed("/")
  if (!canRender) return null

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
                Sign up with an email and password.
              </p>
            </div>

            <SignUpForm />

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
