import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { CLIP_MEDIA_CLASS } from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import { useCallback, useState } from "react"

const HANDOFF_POSTER_TTL_MS = 10_000

export interface LibraryHandoffPoster {
  src?: string
  blurHash?: string | null
  fallbackSeed: string | number
}

interface StoredHandoffPoster {
  poster: LibraryHandoffPoster
  expiresAt: number
}

const handoffPosters = new Map<string, StoredHandoffPoster>()

export function setLibraryHandoffPoster(
  captureId: string,
  poster: LibraryHandoffPoster,
): void {
  if (!poster.src && !poster.blurHash) return
  handoffPosters.set(captureId, {
    poster,
    expiresAt: Date.now() + HANDOFF_POSTER_TTL_MS,
  })
}

export function readLibraryHandoffPoster(
  captureId: string,
): LibraryHandoffPoster | null {
  const entry = handoffPosters.get(captureId)
  if (!entry || entry.expiresAt < Date.now()) return null
  return entry.poster
}

export function clearLibraryHandoffPoster(captureId: string): void {
  handoffPosters.delete(captureId)
}

/**
 * The poster another editor handed this one, held until the player paints its
 * first frame. Editors remount per entry, so the poster is read once on mount
 * and dropped from the handoff map as soon as the frame is up.
 */
export function useLibraryHandoffPoster(captureId: string) {
  const [poster] = useState(() => readLibraryHandoffPoster(captureId))
  const [frameReady, setFrameReady] = useState(poster === null)
  const markFrameReady = useCallback(() => {
    setFrameReady(true)
    if (poster) clearLibraryHandoffPoster(captureId)
  }, [captureId, poster])

  return { poster, frameReady, markFrameReady }
}

export function LibraryHandoffPosterOverlay({
  poster,
  ready,
}: {
  poster: LibraryHandoffPoster | null
  ready: boolean
}) {
  const image = useImageLoaded(poster?.src)
  // The poster whose fade-out finished; a different poster shows again.
  const [dismissed, setDismissed] = useState<LibraryHandoffPoster | null>(null)

  if (!poster || dismissed === poster) return null

  const visible = !ready
  const showImage = Boolean(poster.src && image.loaded)

  return (
    <div
      aria-hidden
      onTransitionEnd={() => {
        if (ready) setDismissed(poster)
      }}
      className={cn(
        "pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-md bg-black",
        "transition-opacity duration-200 ease-out",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <MediaPlaceholder
        seed={poster.fallbackSeed}
        blurHash={poster.blurHash}
        className={cn(
          "transition-opacity duration-200 ease-out",
          showImage ? "opacity-0" : "opacity-100",
        )}
      />
      {poster.src ? (
        <img
          ref={image.ref}
          src={poster.src}
          alt=""
          className={cn(
            CLIP_MEDIA_CLASS,
            "transition-opacity duration-200 ease-out",
            showImage ? "opacity-100" : "opacity-0",
          )}
          decoding="async"
          fetchPriority="high"
          onLoad={image.markLoaded}
        />
      ) : null}
    </div>
  )
}
