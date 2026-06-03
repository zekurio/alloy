import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import { cn } from "@workspace/ui/lib/utils"
import type { PublicLoginSplashConfig } from "@workspace/api"

import {
  hasLoginArtworkImage,
  LoginArtwork,
} from "@/components/auth/login-artwork"

type AuthPageFrameProps = {
  splash: PublicLoginSplashConfig
  children: ReactNode
  fill?: boolean
}

export function AuthBackdrop({ splash }: { splash: PublicLoginSplashConfig }) {
  const showArtwork = splash.enabled && hasLoginArtworkImage(splash.imageUrl)
  if (!showArtwork) return null

  // Blur the artwork directly with `filter` rather than `backdrop-filter`:
  // backdrop-filter under-samples at the overflow-hidden clip edge, leaving a
  // sharp frame. We over-scan the image past the visible bounds by twice the
  // blur radius so the feathered, semi-transparent edges land outside the clip.
  const overscan = Math.ceil(splash.blurPx) * 2

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute"
        style={{
          inset: `${-overscan}px`,
          filter: splash.blurPx > 0 ? `blur(${splash.blurPx}px)` : undefined,
        }}
      >
        <LoginArtwork imageUrl={splash.imageUrl!} />
      </div>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundColor: `rgb(5 6 9 / ${splash.darkenOpacity})`,
        }}
      />
    </div>
  )
}

export function AuthPageFrame({ splash, children, fill }: AuthPageFrameProps) {
  const heightClass = fill ? "h-full min-h-full" : "min-h-screen"
  return (
    <div
      className={cn(
        "relative w-full bg-background text-foreground",
        heightClass,
      )}
    >
      <AuthBackdrop splash={splash} />

      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <Link to="/" className="inline-flex items-center">
          <AlloyLogo showText size={36} />
        </Link>
      </header>

      <div
        className={cn(
          "relative flex items-center justify-center px-6 py-24 sm:px-10",
          heightClass,
        )}
      >
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  )
}
