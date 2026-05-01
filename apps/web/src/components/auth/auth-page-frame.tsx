import { useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import { cn } from "@workspace/ui/lib/utils"

import { pickEmptyStateKaomoji } from "@/lib/kaomoji"
import type { PublicClip } from "@/lib/public-clips"

import {
  hasLoginArtworkClips,
  LoginArtwork,
} from "@/components/auth/login-artwork"

type AuthPageFrameProps = {
  clips: PublicClip[] | null
  children: ReactNode
}

export function AuthPageFrame({ clips, children }: AuthPageFrameProps) {
  const showArtwork = clips !== null && hasLoginArtworkClips(clips)
  const hasPendingOrArtwork = clips === null || showArtwork

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {clips === null ? (
          <AuthArtworkPending />
        ) : showArtwork ? (
          <LoginArtwork clips={clips} />
        ) : null}
      </div>

      <div className="relative grid min-h-screen lg:grid-cols-[1fr_minmax(432px,0.42fr)]">
        <div className="relative hidden min-h-screen overflow-hidden lg:block">
          {clips === null ? (
            <AuthArtworkPending />
          ) : showArtwork ? (
            <AuthArtworkShade />
          ) : (
            <AuthKaomoji />
          )}
        </div>

        <div
          className={cn(
            "relative flex min-h-screen flex-col px-6 py-8 sm:px-10",
            hasPendingOrArtwork &&
              "bg-background/88 shadow-[-32px_0_80px_-64px_rgb(0_0_0/0.9)] backdrop-blur-xl lg:border-l lg:border-white/8 lg:bg-background/86",
            !hasPendingOrArtwork && "bg-background"
          )}
        >
          {hasPendingOrArtwork ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.2),rgb(0_0_0/0.42))] lg:bg-[linear-gradient(90deg,rgb(0_0_0/0.08),rgb(0_0_0/0.38))]"
            />
          ) : null}
          <header className="absolute top-8 left-6 flex items-center sm:left-10">
            <Link to="/" className="inline-flex items-center">
              <AlloyLogo showText size={36} />
            </Link>
          </header>

          <div className="flex flex-1 items-center justify-center py-24">
            <div className="w-full max-w-sm">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AuthArtworkShade() {
  return (
    <>
      <div className="absolute inset-y-0 left-0 w-px bg-white/8" />
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-background/5 to-background/24" />
    </>
  )
}

function AuthArtworkPending() {
  return (
    <div
      aria-hidden
      className="h-full min-h-screen bg-surface"
      style={{
        background:
          "linear-gradient(135deg, oklch(0.24 0 0) 0%, oklch(0.18 0 0) 100%)",
      }}
    />
  )
}

function AuthKaomoji() {
  const [kaomoji] = useState(() => pickEmptyStateKaomoji())

  return (
    <div
      aria-hidden
      className="flex h-full min-h-screen items-center justify-center bg-surface px-10"
    >
      <div className="text-[clamp(48px,7vw,120px)] leading-none font-semibold text-foreground-muted/65 select-none">
        {kaomoji}
      </div>
    </div>
  )
}
