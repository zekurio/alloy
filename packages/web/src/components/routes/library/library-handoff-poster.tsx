import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { CLIP_MEDIA_CLASS } from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

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

export function LibraryHandoffPosterOverlay({
  poster,
  ready,
}: {
  poster: LibraryHandoffPoster | null
  ready: boolean
}) {
  const imageRef = React.useRef<HTMLImageElement | null>(null)
  const [mounted, setMounted] = React.useState(poster !== null)
  const [imageLoaded, setImageLoaded] = React.useState(false)

  React.useEffect(() => {
    setMounted(poster !== null)
    setImageLoaded(false)
  }, [poster])

  React.useEffect(() => {
    if (!poster?.src) return
    const image = imageRef.current
    setImageLoaded(Boolean(image?.complete && image.naturalWidth > 0))
  }, [poster?.src])

  if (!poster || !mounted) return null

  const visible = !ready
  const showImage = Boolean(poster.src && imageLoaded)

  return (
    <div
      aria-hidden
      onTransitionEnd={() => {
        if (ready) setMounted(false)
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
          ref={imageRef}
          src={poster.src}
          alt=""
          className={cn(
            CLIP_MEDIA_CLASS,
            "transition-opacity duration-200 ease-out",
            showImage ? "opacity-100" : "opacity-0",
          )}
          decoding="async"
          fetchPriority="high"
          onLoad={() => setImageLoaded(true)}
        />
      ) : null}
    </div>
  )
}
