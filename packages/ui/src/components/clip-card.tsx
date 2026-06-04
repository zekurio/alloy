import * as React from "react"
import { LinkIcon, LockIcon } from "lucide-react"

import { GameIcon } from "@workspace/ui/components/game-icon"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
  CLIP_VIDEO_MEDIA_CLASS,
} from "@workspace/ui/lib/media-frame"
import { stableHue } from "@workspace/ui/lib/stable-hash"
import { cn } from "@workspace/ui/lib/utils"

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
  accentHue,
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
      className={cn("group/clip-card flex flex-col gap-3", className)}
      {...props}
    >
      <ClipCardThumb
        title={title}
        thumbnail={thumbnail}
        accentHue={accentHue}
        streamUrl={streamUrl}
        onClick={onThumbnailClick}
        onIntent={onThumbnailIntent}
        onPreviewError={onPreviewError}
        label={thumbnailLabel ?? title}
        buttonRef={thumbnailRef}
      />
      <div className="flex items-start gap-2.5">
        {author
          ? (
            <ClipCardAvatar
              author={author}
              authorSeed={authorSeed}
              authorImage={authorImage}
              authorInitials={authorInitials}
              authorAvatarBg={authorAvatarBg}
              authorAvatarFg={authorAvatarFg}
            />
          )
          : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Title owns its own row. */}
          <div className="truncate text-lg leading-snug font-semibold tracking-[-0.015em] text-foreground">
            {titleContent ?? title}
          </div>

          <div className="flex min-w-0 items-center gap-1.5 text-base leading-tight text-foreground-dim">
            {author
              ? (
                <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <AuthorLabel author={author} href={authorHref} />
                  <span className="shrink-0 text-foreground-faint">·</span>
                  <GameLabel game={game} icon={gameIcon} href={gameHref} />
                </span>
              )
              : <GameLabel game={game} icon={gameIcon} href={gameHref} />}
          </div>

          {metaVariant === "showcase"
            ? null
            : (
              <div className="flex min-w-0 items-center gap-1.5 text-sm leading-tight text-foreground-faint tabular-nums">
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
  accentHue,
  streamUrl,
  onClick,
  onIntent,
  onPreviewError,
  label,
  buttonRef,
}: {
  title: string
  thumbnail: string | undefined
  accentHue: number | undefined
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
  const fallback = renderThumbnailFallback(accentHue)
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
    <>
      {fallback}

      {thumbnail && !thumbnailFailed
        ? (
          <img
            src={thumbnail}
            alt={title}
            className={cn(
              CLIP_MEDIA_CLASS,
              "transition-opacity duration-200 ease-out",
              thumbnailLoaded ? "opacity-100" : "opacity-0",
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
        )
        : null}

      {
        /* Hover preview overlay. Mounted only when we actually have a
          stream URL — keeps the DOM light for mock decks and
          still-encoding rows. We intentionally avoid `crossOrigin`
          here: the request starts same-origin so cookies still reach
          the auth gate, and S3-backed redirects then remain compatible
          with buckets that do not allow credentialed CORS media loads. */
      }
      {canPreview && previewMounted
        ? (
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
              CLIP_VIDEO_MEDIA_CLASS,
              "bg-[oklch(12%_0.01_250)]",
              "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              previewing ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          />
        )
        : null}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-px z-10 h-px bg-[oklch(12%_0.01_250)]"
      />
    </>
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

function renderThumbnailFallback(accentHue: number | undefined) {
  if (accentHue !== undefined) {
    return (
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            `linear-gradient(135deg, oklch(0.3 0.1 ${accentHue}) 0%, oklch(0.15 0.05 ${accentHue}) 70%, oklch(0.08 0 0) 100%)`,
        }}
      />
    )
  }

  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-0 grid place-items-center",
        "font-mono text-2xs tracking-[0.1em] text-foreground-faint uppercase",
      )}
      style={{
        background:
          "repeating-linear-gradient(45deg, oklch(0.18 0 0) 0 8px, oklch(0.16 0 0) 8px 16px)",
      }}
    >
      clip preview
    </div>
  )
}

function AuthorLabel({
  author,
  href,
}: {
  author: string
  href: string | null | undefined
}) {
  const className = cn(
    "max-w-[45%] shrink-0 truncate leading-tight font-medium text-foreground-muted",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none",
  )
  if (href) {
    return (
      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        className={className}
      >
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
    const hue = stableHue(seed)
    fallbackBg = `oklch(0.32 0.18 ${hue})`
    fallbackFg = `oklch(0.92 0.1 ${hue})`
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full",
        "text-[13px] leading-none font-semibold",
      )}
      style={{
        background: fallbackBg,
        color: fallbackFg,
      }}
    >
      {authorImage && !imageFailed
        ? (
          <img
            src={authorImage}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        )
        : initials}
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
      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        className={className}
      >
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
  const label = privacy === "private"
    ? "Private — only you"
    : "Unlisted — only via link"
  return (
    <span
      className="inline-flex items-center text-foreground-faint"
      title={label}
      aria-label={label}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  )
}

export { ClipCard, type ClipCardProps }
