import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_ROUNDED_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent, Ref } from "react"

const HOVER_PREVIEW_DELAY_MS = 250

interface ClipCardThumbProps {
  title: string
  thumbnail: string | undefined
  thumbnailFallback?: string | undefined
  thumbnailBlurHash: string | null | undefined
  thumbnailFallbackBlurHash?: string | null | undefined
  fallbackSeed: string | number
  streamUrl: string | undefined
  onClick?: () => void
  onIntent?: () => void
  onPreviewError?: (cause: unknown) => void
  label?: string
  buttonRef?: Ref<HTMLButtonElement>
}

export function ClipCardThumb({
  title,
  thumbnail,
  thumbnailFallback,
  thumbnailBlurHash,
  thumbnailFallbackBlurHash,
  fallbackSeed,
  streamUrl,
  onClick,
  onIntent,
  onPreviewError,
  label,
  buttonRef,
}: ClipCardThumbProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const hoveredRef = useRef(false)
  const shouldPreviewRef = useRef(false)
  const preloadedThumbnailRef = useRef<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewMounted, setPreviewMounted] = useState(false)
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const [thumbnailFallbackFailed, setThumbnailFallbackFailed] = useState(false)
  const [pointerActivated, setPointerActivated] = useState(false)

  useEffect(() => {
    setThumbnailFailed(false)
    setThumbnailFallbackFailed(false)
    const image = imageRef.current
    setThumbnailLoaded(Boolean(image?.complete && image.naturalWidth > 0))
  }, [thumbnail, thumbnailFallback])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const canPreview = Boolean(streamUrl)

  const activeThumbnail =
    thumbnail && !thumbnailFailed
      ? thumbnail
      : thumbnailFallback && !thumbnailFallbackFailed
        ? thumbnailFallback
        : undefined
  const activeBlurHash = thumbnailBlurHash ?? thumbnailFallbackBlurHash

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
    } else if (v.readyState >= HTMLMediaElement.HAVE_METADATA) {
      v.currentTime = 0
    }
    void v
      .play()
      .then(revealPreview)
      .catch((cause: unknown) => {
        // Leaving mid-load aborts the play request; that is not an error.
        if (!shouldPreviewRef.current) return
        onPreviewError?.(cause)
        setPreviewing(false)
      })
  }, [onPreviewError, revealPreview, streamUrl])

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
    "group/clip-thumb w-full appearance-none rounded-md border-0 p-0 text-left",
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
    <div className={cn("absolute inset-0", CLIP_MEDIA_ROUNDED_CLASS)}>
      <MediaPlaceholder seed={fallbackSeed} blurHash={activeBlurHash} />

      {activeThumbnail ? (
        <img
          ref={imageRef}
          src={activeThumbnail}
          alt={title}
          className={cn(
            CLIP_MEDIA_CLASS,
            "transition-opacity duration-200 ease-out",
            thumbnailLoaded ? "opacity-100" : "opacity-0",
          )}
          loading="lazy"
          decoding="async"
          onLoad={() => setThumbnailLoaded(true)}
          onError={() => {
            setThumbnailLoaded(false)
            if (activeThumbnail === thumbnail) {
              setThumbnailFailed(true)
              return
            }
            setThumbnailFallbackFailed(true)
          }}
        />
      ) : null}

      {canPreview && previewMounted ? (
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          preload="auto"
          onLoadedData={startPreview}
          onCanPlay={startPreview}
          onPlaying={revealPreview}
          onTimeUpdate={revealPreview}
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
        ref={buttonRef}
        onClick={onClick}
        aria-label={label}
        data-pointer-activated={pointerActivated ? "true" : undefined}
        className={surfaceClass}
        {...hoverHandlers}
      >
        {body}
      </button>
    )
  }

  return (
    <div className={surfaceClass} {...hoverHandlers}>
      {body}
    </div>
  )
}
