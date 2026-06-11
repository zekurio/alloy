import type { PublicLoginSplashConfig } from "@alloy/api"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { LoginBackdrop } from "@/components/auth/login-backdrop"

type AuthPageFrameProps = {
  splash: PublicLoginSplashConfig
  children: ReactNode
  fill?: boolean
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
      <LoginBackdrop
        enabled={splash.enabled}
        blurPx={splash.blurPx}
        darkenOpacity={splash.darkenOpacity}
      />

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
