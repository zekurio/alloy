import type { PublicLoginSplashConfig } from "@alloy/api"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { AppHeaderWindowControls } from "@alloy/ui/components/app-header"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { LoginBackdrop } from "@/components/auth/login-backdrop"
import { alloyDesktop } from "@/lib/desktop"

type AuthPageFrameProps = {
  splash: PublicLoginSplashConfig
  children: ReactNode
  fill?: boolean
  desktopChrome?: boolean
}

export function AuthPageFrame({
  splash,
  children,
  fill,
  desktopChrome = true,
}: AuthPageFrameProps) {
  const heightClass = fill ? "h-full min-h-full" : "min-h-screen"
  const desktop = desktopChrome ? alloyDesktop() : null
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

      <header
        data-slot={desktop?.titlebarOverlay ? "app-header" : undefined}
        className={cn(
          "absolute top-8 left-6 z-10 flex items-center sm:left-10",
          desktop?.titlebarOverlay &&
            "top-0 right-0 left-0 h-[var(--header-h)] px-4 sm:left-0",
        )}
      >
        <Link to="/" className="inline-flex items-center">
          <AlloyLogo showText size={36} />
        </Link>
        {desktop?.titlebarOverlay ? (
          <AppHeaderWindowControls
            className="absolute top-0 right-0 h-[var(--header-h)]"
            onMinimize={() => {
              void desktop.minimizeWindow()
            }}
            onToggleMaximize={() => {
              void desktop.toggleMaximizeWindow()
            }}
            onClose={() => {
              void desktop.closeWindow()
            }}
          />
        ) : null}
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
