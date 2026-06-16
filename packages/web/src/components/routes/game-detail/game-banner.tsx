import type { GameDetail } from "@alloy/api"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { PROFILE_BANNER_ASPECT_CLASS } from "@/lib/banner-layout"

/**
 * Sharp hero strip at the top of the floating game card, locked to the same
 * aspect ratio the profile banner uses. The parent card owns the rounded
 * corners (via `overflow-hidden`); a soft bottom fade eases the art into the
 * frosted body below. The blurhash placeholder shows until the art decodes.
 */
export function GameBanner({ game }: { game: GameDetail }) {
  const [failed, setFailed] = React.useState(false)
  const heroUrl = game.heroUrl && !failed ? game.heroUrl : null

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden",
        PROFILE_BANNER_ASPECT_CLASS,
      )}
    >
      <MediaPlaceholder
        seed={game.steamgriddbId}
        blurHash={game.heroBlurHash}
      />
      {heroUrl ? (
        <img
          src={heroUrl}
          alt=""
          decoding="async"
          className="absolute inset-0 size-full object-cover object-center"
          onError={() => setFailed(true)}
        />
      ) : null}
      <div className="to-surface-sunken/40 absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent" />
    </div>
  )
}
