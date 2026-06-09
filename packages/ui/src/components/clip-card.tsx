import { GameIcon } from "alloy-ui/components/game-icon"
import { MediaPlaceholder } from "alloy-ui/components/media-placeholder"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_ROUNDED_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "alloy-ui/lib/media-frame"
import { pastelAvatarColors } from "alloy-ui/lib/pastel"
import { cn } from "alloy-ui/lib/utils"
import { LinkIcon, LockIcon } from "lucide-react"
import * as React from "react"

interface ClipCardProps extends React.ComponentProps<"article"> {
  title: string
  titleContent?: React.ReactNode
  author: string
  authorSeed?: string
  authorImage?: string | null
  authorInitials?: string
  authorAvatarBg?: string
  authorAvatarFg?: string
  authorHref?: string | null
  game: string
  gameIcon?: string | null
  gameHref?: string | null
  views: string
  likes: string
  comments?: string | number
  postedAt?: string
  thumbnail?: string
  thumbnailBlurHash?: string | null
  fallbackSeed?: string | number
  accentHue?: number
  streamUrl?: string
  privacy?: "public" | "unlisted" | "private"
  /** When set, the thumbnail becomes a button that fires this handler. */
  onThumbnailClick?: () => void
  /** Fires on hover/focus/press so callers can warm data before open. */
  onThumbnailIntent?: () => void
  /** Fires when hover-preview video playback is rejected by the browser. */
  onPreviewError?: (cause: unknown) => void
  /** Accessible label for the thumbnail button. */
  thumbnailLabel?: string
  thumbnailRef?: React.Ref<HTMLButtonElement>
  metaVariant?: "default" | "showcase"
}

const HOVER_PREVIEW_DELAY_MS = 250

function ClipCard({
  className,
  title,
  titleContent,
  author,
  authorSeed,
  authorImage,
  authorInitials,
  authorAvatarBg,
  authorAvatarFg,
  authorHref,
  game,
  gameIcon,
  gameHref,
  views,
  // Likes and comments stay in the contract but are no longer shown on the
  // card face — the meta line mirrors the channel-style "views · age" layout.
  likes: _likes,
  comments: _comments,
  postedAt = "2h ago",
  thumbnail,
  thumbnailBlurHash,
  fallbackSeed,
  // Retained on the contract for callers; fallback color is now seed-driven.
  accentHue: _accentHue,
  streamUrl,
  privacy,
  onThumbnailClick,
  onThumbnailIntent,
  onPreviewError,
  thumbnailLabel,
  thumbnailRef,
  metaVariant = "default",
  ...props
}: ClipCardProps) {
  const privacyBadge = renderPrivacyBadge(privacy)

  return (
    <article
      data-slot="clip-card"
      className={cn("group/clip-card flex flex-col gap-2.5", className)}
      {...props}
    >
      <ClipCardThumb
        title={title}
        thumbnail={thumbnail}
        thumbnailBlurHash={thumbnailBlurHash}
        fallbackSeed={fallbackSeed ?? game}
        streamUrl={streamUrl}
        onClick={onThumbnailClick}
        onIntent={onThumbnailIntent}
        onPreviewError={onPreviewError}
        label={thumbnailLabel ?? title}
        buttonRef={thumbnailRef}
      />
      <div className="flex items-start gap-2.5">
        {author ? (
          <ClipCardAvatar
            author={author}
            authorSeed={authorSeed}
            authorImage={authorImage}
            authorInitials={authorInitials}
            authorAvatarBg={authorAvatarBg}
            authorAvatarFg={authorAvatarFg}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Title owns its own row. Type is a fixed size — not scaled to the
              card width — so the meta block reads identically whether the deck
              shows 3 or 5 columns. The thumbnail above stays 16:9 and resizes
              with the column count; the metadata deliberately does not. */}
          <div className="text-foreground truncate text-[1.0625rem] leading-snug font-semibold tracking-[-0.015em]">
            {titleContent ?? title}
          </div>

          <div className="text-foreground-dim flex min-w-0 items-center gap-1.5 text-[0.9375rem] leading-tight">
            {author ? (
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <AuthorLabel author={author} href={authorHref} />
                <span className="text-foreground-faint shrink-0">·</span>
                <GameLabel game={game} icon={gameIcon} href={gameHref} />
              </span>
            ) : (
              <GameLabel game={game} icon={gameIcon} href={gameHref} />
            )}
          </div>

          {metaVariant === "showcase" ? null : (
            <div className="text-foreground-faint flex min-w-0 items-center gap-1.5 text-sm leading-tight tabular-nums">
              {privacyBadge}
              <span className="shrink-0">{views} views</span>
              <span className="shrink-0">·</span>
              <span className="truncate">{postedAt}</span>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function ClipCardThumb({
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
}: {
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
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
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
    setThumbnailLoaded(false)
    setThumbnailFailed(false)
  }, [thumbnail])

  // Clear any pending hover timer when the component unmounts — stray
  // setTimeouts would otherwise touch a detached video ref after a fast
  // navigate-away.
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
  const fallback = renderThumbnailFallback(thumbnailBlurHash, fallbackSeed)
  const surfaceClass = cn(
    "group/clip-thumb w-full appearance-none rounded-md border-0 p-0 text-left",
    CLIP_MEDIA_VIEWPORT_CLASS,
    "transition-[transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    interactive &&
      "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none data-[pointer-activated=true]:focus-visible:ring-0 data-[pointer-activated=true]:focus-visible:ring-offset-0",
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
      schedulePreview()
    },
    onBlur: () => {
      setPointerActivated(false)
      cancelPreview()
    },
  }

  const body = (
    // One mask rounds the whole frame, so the still and the preview video share
    // identical corners — no per-element insets, no fringe, no shift.
    <div className={cn("absolute inset-0", CLIP_MEDIA_ROUNDED_CLASS)}>
      {fallback}

      {thumbnail && !thumbnailFailed ? (
        <img
          src={thumbnail}
          alt={title}
          className={cn(
            CLIP_MEDIA_CLASS,
            "transition-opacity duration-200 ease-out",
            // Hide the still while the preview plays. The video sits on a 1px
            // clip-path inset (to mask encoder edge lines); leaving the thumb
            // visible underneath makes that inset read as a fringe around the
            // playing clip.
            thumbnailLoaded && !previewing ? "opacity-100" : "opacity-0",
          )}
          // Cards load in a scrolling grid — let the browser lazy-load
          // anything outside the initial viewport.
          loading="lazy"
          decoding="async"
          onLoad={() => setThumbnailLoaded(true)}
          onError={() => {
            setThumbnailLoaded(false)
            setThumbnailFailed(true)
          }}
        />
      ) : null}

      {/* Hover preview overlay. Mounted only when we actually have a
          stream URL — keeps the DOM light for mock decks and
          still-encoding rows. We intentionally avoid `crossOrigin`
          here: the request starts same-origin so cookies still reach
          the auth gate, and S3-backed redirects then remain compatible
          with buckets that do not allow credentialed CORS media loads. */}
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

function renderThumbnailFallback(
  thumbnailBlurHash: string | null | undefined,
  fallbackSeed: string | number,
) {
  return <MediaPlaceholder seed={fallbackSeed} blurHash={thumbnailBlurHash} />
}

function AuthorLabel({
  author,
  href,
}: {
  author: string
  href: string | null | undefined
}) {
  const className = cn(
    "max-w-[65%] shrink truncate leading-tight font-medium text-foreground-muted",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none",
  )
  if (href) {
    return (
      <a href={href} onClick={(e) => e.stopPropagation()} className={className}>
        {author}
      </a>
    )
  }
  return <span className={className}>{author}</span>
}

function ClipCardAvatar({
  author,
  authorSeed,
  authorImage,
  authorInitials,
  authorAvatarBg,
  authorAvatarFg,
}: {
  author: string
  authorSeed: string | undefined
  authorImage: string | null | undefined
  authorInitials: string | undefined
  authorAvatarBg: string | undefined
  authorAvatarFg: string | undefined
}) {
  const [imageFailed, setImageFailed] = React.useState(false)

  React.useEffect(() => {
    setImageFailed(false)
  }, [authorImage])

  const initials = authorInitials ?? (author.slice(0, 2).toUpperCase() || "?")
  const seed = authorSeed || author || "user"
  let fallbackBg = authorAvatarBg
  let fallbackFg = authorAvatarFg
  if (!fallbackBg || !fallbackFg) {
    const colors = pastelAvatarColors(seed)
    fallbackBg = colors.bg
    fallbackFg = colors.fg
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full",
        "text-sm leading-none font-semibold",
      )}
      style={{
        background: fallbackBg,
        color: fallbackFg,
      }}
    >
      {authorImage && !imageFailed ? (
        <img
          src={authorImage}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        initials
      )}
    </span>
  )
}

function GameLabel({
  game,
  icon,
  href,
}: {
  game: string
  icon: string | null | undefined
  href: string | null | undefined
}) {
  const className = cn(
    "inline-flex min-w-0 items-center gap-1.5 truncate leading-tight text-accent",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none",
  )
  const content = (
    <>
      <GameIcon src={icon} name={game} size="sm" />
      <span className="truncate">{game}</span>
    </>
  )
  if (href) {
    return (
      <a href={href} onClick={(e) => e.stopPropagation()} className={className}>
        {content}
      </a>
    )
  }
  return <span className={className}>{content}</span>
}

function renderPrivacyBadge(
  privacy: ClipCardProps["privacy"],
): React.ReactNode {
  if (!privacy || privacy === "public") return null
  const Icon = privacy === "private" ? LockIcon : LinkIcon
  const label =
    privacy === "private" ? "Private — only you" : "Unlisted — only via link"
  return (
    <span
      className="text-foreground-faint inline-flex items-center"
      title={label}
      aria-label={label}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  )
}

export { ClipCard, type ClipCardProps }
