import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import type { PublicLoginSplashConfig } from "@workspace/api"

import {
  hasLoginArtworkImage,
  LoginArtwork,
} from "@/components/auth/login-artwork"

type AuthPageFrameProps = {
  splash: PublicLoginSplashConfig
  children: ReactNode
}

export function AuthPageFrame({ splash, children }: AuthPageFrameProps) {
  const showArtwork = splash.enabled && hasLoginArtworkImage(splash.imageUrl)

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {showArtwork ? <LoginArtwork imageUrl={splash.imageUrl!} /> : null}
      </div>
      {showArtwork
        ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-background/80 backdrop-blur-xl"
          />
        )
        : null}

      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <Link to="/" className="inline-flex items-center">
          <AlloyLogo showText size={36} />
        </Link>
      </header>

      <div className="relative flex min-h-screen items-center justify-center px-6 py-24 sm:px-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  )
}
