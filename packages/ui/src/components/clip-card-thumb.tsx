import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_ROUNDED_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent } from "react"

const HOVER_PREVIEW_DELAY_MS = 250

interface ClipCardThumbProps {
  imageAspectRatio?: number
  title: string
  thumbnail: string | undefined
  /** `srcset` for `thumbnail`; the fallback has no resized copies. */
  thumbnailSrcSet?: string | undefined
  /** `sizes` for `thumbnailSrcSet`. */
  thumbnailSizes?: string | undefined
  thumbnailFallback?: string | undefined
  thumbnailBlurHash: string | null | undefined
  thumbnailFallbackBlurHash?: string | null | undefined
  fallbackSeed: string | number
  streamUrl: string | undefined
  /** Window within the preview source that maps to this clip. */
  streamRange?: { start: number; end: number }
  onClick?: () => void
  onIntent?: () => void
  onPreviewError?: (cause: unknown) => void
  label?: string
}

export function ClipCardThumb({
  imageAspectRatio,
  title,
  thumbnail,
  thumbnailSrcSet,
  thumbnailSizes,
  thumbnailFallback,
  thumbnailBlurHash,
  thumbnailFallbackBlurHash,
  fallbackSeed,
  streamUrl,
  streamRange,
  onClick,
  onIntent,
  onPreviewError,
  label,
}: ClipCardThumbProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const hoveredRef = useRef(false)
  const shouldPreviewRef = useRef(false)
  const preloadedThumbnailRef = useRef<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewMounted, setPreviewMounted] = useState(false)
  const [failedThumbnails, setFailedThumbnails] = useState<readonly string[]>(
    [],
  )
  const [pointerActivated, setPointerActivated] = useState(false)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const canPreview = Boolean(streamUrl)

  const activeThumbnail = [thumbnail, thumbnailFallback].find(
    (src) => src && !failedThumbnails.includes(src),
  )
  const activeBlurHash = thumbnailBlurHash ?? thumbnailFallbackBlurHash
  const image = useImageLoaded(activeThumbnail)
  const thumbnailLoaded = image.loaded

  const preloadThumbnail = () => {
    if (!activeThumbnail) return
    if (preloadedThumbnailRef.current === activeThumbnail) return
    preloadedThumbnailRef.current = activeThumbnail
    const image = new Image()
    image.decoding = "async"
    image.src = activeThumbnail
  }

  const revealPreview = useCallback(() => {
    const v = videoRef.current
    if (!v || !hoveredRef.current || !shouldPreviewRef.current || v.paused) {
      return
    }

    if ("requestVideoFrameCallback" in v) {
      v.requestVideoFrameCallback(() => {
        if (hoveredRef.current && shouldPreviewRef.current && !v.paused) {
          setPreviewing(true)
        }
      })
      return
    }

    setPreviewing(true)
  }, [])

  const startPreview = useCallback(() => {
    const v = videoRef.current
    if (!v || !streamUrl || !hoveredRef.current || !shouldPreviewRef.current) {
      return
    }

    if (!v.paused) {
      revealPreview()
      return
    }

    // The source only attaches once the hover dwell elapses, so a quick
    // pointer pass across the grid never starts a download.
    if (v.getAttribute("src") !== streamUrl) {
      v.src = streamUrl
      v.load()
    }
    if (v.readyState < HTMLMediaElement.HAVE_METADATA) return

    v.currentTime = previewStart(streamRange)
    void v
      .play()
      .then(revealPreview)
      .catch((cause: unknown) => {
        // Leaving mid-load aborts the play request; that is not an error.
        if (!shouldPreviewRef.current) return
        onPreviewError?.(cause)
        setPreviewing(false)
      })
  }, [onPreviewError, revealPreview, streamRange, streamUrl])

  const handlePreviewTimeUpdate = () => {
    const video = videoRef.current
    if (video && streamRange && video.currentTime >= streamRange.end - 0.01) {
      video.currentTime = previewStart(streamRange)
      void video.play().catch(() => undefined)
    }
    revealPreview()
  }

  useEffect(() => {
    if (!previewMounted || !hoveredRef.current) return
    startPreview()
  }, [previewMounted, startPreview])

  const schedulePreview = () => {
    if (!canPreview) return
    hoveredRef.current = true
    setPreviewMounted(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      shouldPreviewRef.current = true
      startPreview()
    }, HOVER_PREVIEW_DELAY_MS)
  }

  const cancelPreview = () => {
    hoveredRef.current = false
    shouldPreviewRef.current = false
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const v = videoRef.current
    if (v) {
      v.pause()
      // Detaching the source aborts the in-flight download; abandoned
      // previews would otherwise keep buffering in the background.
      v.removeAttribute("src")
      v.load()
    }
    setPreviewing(false)
  }

  const interactive = Boolean(onClick)
  const surfaceClass = cn(
    "group/clip-thumb w-full appearance-none rounded-none border-0 p-0 text-left md:rounded-md",
    CLIP_MEDIA_VIEWPORT_CLASS,
    "transition-[transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    interactive &&
      "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none data-[pointer-activated=true]:focus-visible:ring-0",
  )
  const hoverHandlers = {
    onPointerEnter: (e: PointerEvent) => {
      onIntent?.()
      preloadThumbnail()
      if (e.pointerType === "touch") return
      schedulePreview()
    },
    onPointerDown: () => {
      setPointerActivated(true)
      onIntent?.()
      preloadThumbnail()
    },
    onKeyDown: () => {
      setPointerActivated(false)
    },
    onPointerLeave: cancelPreview,
    onFocus: () => {
      onIntent?.()
      preloadThumbnail()
    },
    onBlur: () => {
      setPointerActivated(false)
      cancelPreview()
    },
  }

  const body = (
    <div
      className={cn(
        "absolute inset-0 max-md:rounded-none max-md:[clip-path:none]",
        CLIP_MEDIA_ROUNDED_CLASS,
      )}
    >
      <MediaPlaceholder
        seed={fallbackSeed}
        blurHash={activeBlurHash}
        // Anything painted under the still tints its antialiased corner
        // pixels, so drop the placeholder once the still has faded in.
        className={cn(
          "transition-opacity duration-0",
          thumbnailLoaded && !previewing && "opacity-0 delay-200",
        )}
      />

      {activeThumbnail ? (
        <img
          ref={image.ref}
          src={activeThumbnail}
          srcSet={activeThumbnail === thumbnail ? thumbnailSrcSet : undefined}
          sizes={activeThumbnail === thumbnail ? thumbnailSizes : undefined}
          alt={title}
          className={cn(
            CLIP_MEDIA_CLASS,
            "transition-opacity duration-200 ease-out",
            // Hide the still while the preview plays; the contained video box
            // can be sub-pixel smaller than the thumbnail, which otherwise
            // leaves a sliver of the thumbnail visible along the edges.
            thumbnailLoaded && !previewing ? "opacity-100" : "opacity-0",
          )}
          loading="lazy"
          decoding="async"
          onLoad={image.markLoaded}
          onError={() => {
            // Moves on to the fallback still, or to the placeholder alone.
            setFailedThumbnails((failed) => [...failed, activeThumbnail])
          }}
        />
      ) : null}

      {canPreview && previewMounted ? (
        <video
          ref={videoRef}
          muted
          loop={!streamRange}
          playsInline
          preload="auto"
          onLoadedMetadata={startPreview}
          onLoadedData={startPreview}
          onCanPlay={startPreview}
          onPlaying={revealPreview}
          onTimeUpdate={handlePreviewTimeUpdate}
          onEnded={streamRange ? startPreview : undefined}
          aria-hidden
          className={cn(
            CLIP_MEDIA_CLASS,
            "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            previewing ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        />
      ) : null}
    </div>
  )

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        data-pointer-activated={pointerActivated ? "true" : undefined}
        className={surfaceClass}
        style={imageAspectRatio ? { aspectRatio: imageAspectRatio } : undefined}
        {...hoverHandlers}
      >
        {body}
      </button>
    )
  }

  return (
    <div
      className={surfaceClass}
      style={imageAspectRatio ? { aspectRatio: imageAspectRatio } : undefined}
      {...hoverHandlers}
    >
      {body}
    </div>
  )
}

function previewStart(range: { start: number; end: number } | undefined) {
  return range && Number.isFinite(range.start) ? Math.max(0, range.start) : 0
}
