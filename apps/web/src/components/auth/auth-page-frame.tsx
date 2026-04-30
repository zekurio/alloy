import { useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"

import { pickEmptyStateKaomoji } from "@/lib/kaomoji"
import type { PublicClip } from "@/lib/public-clips"

import {
  hasLoginArtworkClips,
  LoginArtwork,
} from "@/components/auth/login-artwork"

type AuthPageFrameProps = {
  clips: PublicClip[]
  children: ReactNode
}

export function AuthPageFrame({ clips, children }: AuthPageFrameProps) {
  const showArtwork = hasLoginArtworkClips(clips)

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground">
      <div className="relative grid min-h-screen lg:grid-cols-[1fr_minmax(432px,0.42fr)]">
        <div className="relative hidden min-h-screen overflow-hidden lg:block">
          {showArtwork ? <LoginArtwork clips={clips} /> : <AuthKaomoji />}
        </div>

        <div className="relative flex min-h-screen flex-col bg-background px-6 py-8 sm:px-10">
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
