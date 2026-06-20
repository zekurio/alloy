import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_ROUNDED_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

const HOVER_PREVIEW_DELAY_MS = 250

interface ClipCardThumbProps {
  title: string
  thumbnail: string | undefined
  thumbnailBlurHash: string | null | undefined
  fallbackSeed: string | number
  streamUrl: string | undefined
  onClick?: () => void
  onIntent?: () => void
  onPreviewError?: (cause: unknown) => void
  label?: string
  buttonRef?: React.Ref<HTMLButtonElement>
}

export function ClipCardThumb({
  title,
  thumbnail,
  thumbnailBlurHash,
  fallbackSeed,
  streamUrl,
  onClick,
  onIntent,
  onPreviewError,
  label,
  buttonRef,
}: ClipCardThumbProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const imageRef = React.useRef<HTMLImageElement | null>(null)
  const timerRef = React.useRef<number | null>(null)
  const hoveredRef = React.useRef(false)
  const shouldPreviewRef = React.useRef(false)
  const primedRef = React.useRef(false)
  const preloadedThumbnailRef = React.useRef<string | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [previewMounted, setPreviewMounted] = React.useState(false)
  const [thumbnailLoaded, setThumbnailLoaded] = React.useState(false)
  const [thumbnailFailed, setThumbnailFailed] = React.useState(false)
  const [pointerActivated, setPointerActivated] = React.useState(false)

  React.useEffect(() => {
    setThumbnailFailed(false)
    const image = imageRef.current
    setThumbnailLoaded(Boolean(image?.complete && image.naturalWidth > 0))
  }, [thumbnail])

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const canPreview = Boolean(streamUrl)

  const preloadThumbnail = () => {
    if (!thumbnail || thumbnailFailed) return
    if (preloadedThumbnailRef.current === thumbnail) return
    preloadedThumbnailRef.current = thumbnail
    const image = new Image()
    image.decoding = "async"
    image.src = thumbnail
  }

  const revealPreview = React.useCallback(() => {
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

  const primePreview = React.useCallback(() => {
    const v = videoRef.current
    if (!v || primedRef.current) return
    primedRef.current = true
    v.muted = true
    v.defaultMuted = true
    v.playsInline = true
    v.preload = "auto"
    v.load()
  }, [])

  const startPreview = React.useCallback(() => {
    const v = videoRef.current
    if (!v || !hoveredRef.current || !shouldPreviewRef.current) return

    if (!v.paused) {
      revealPreview()
      return
    }

    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) {
      v.currentTime = 0
    }
    void v
      .play()
      .then(revealPreview)
      .catch((cause: unknown) => {
        onPreviewError?.(cause)
        setPreviewing(false)
      })
  }, [onPreviewError, revealPreview])

  React.useEffect(() => {
    if (!previewMounted || !hoveredRef.current) return
    primePreview()
    startPreview()
  }, [previewMounted, primePreview, startPreview])

  const schedulePreview = () => {
    if (!canPreview) return
    hoveredRef.current = true
    setPreviewMounted(true)
    if (previewMounted) primePreview()
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
      v.currentTime = 0
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
    onPointerEnter: (e: React.PointerEvent) => {
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
      <MediaPlaceholder seed={fallbackSeed} blurHash={thumbnailBlurHash} />

      {thumbnail && !thumbnailFailed ? (
        <img
          ref={imageRef}
          src={thumbnail}
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
            setThumbnailFailed(true)
          }}
        />
      ) : null}

      {canPreview && previewMounted ? (
        <video
          ref={videoRef}
          src={streamUrl}
          muted
          loop
          playsInline
          preload="metadata"
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
