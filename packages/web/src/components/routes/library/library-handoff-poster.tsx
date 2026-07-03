import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { CLIP_MEDIA_CLASS } from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import { useEffect, useState } from "react"

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
  const image = useImageLoaded(poster?.src)
  const [mounted, setMounted] = useState(poster !== null)

  useEffect(() => {
    setMounted(poster !== null)
  }, [poster])

  if (!poster || !mounted) return null

  const visible = !ready
  const showImage = Boolean(poster.src && image.loaded)

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
