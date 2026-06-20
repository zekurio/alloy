import { tp } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_ROUNDED_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

interface ClipCardProps extends React.ComponentProps<"article"> {
  title: string
  titleContent?: React.ReactNode
  author: string
  authorImage?: string | null
  authorInitials?: string
  authorAvatarBg?: string
  authorAvatarFg?: string
  authorHref?: string | null
  renderAuthorLink?: ClipCardLabelLinkRenderer
  game: string
  gameIcon?: string | null
  gameHref?: string | null
  renderGameLink?: ClipCardLabelLinkRenderer
  views: string
  viewCount?: number
  likes: string
  comments?: string | number
  postedAt?: string
  metaContent?: React.ReactNode
  thumbnail?: string
  thumbnailBlurHash?: string | null
  fallbackSeed?: string | number
  accentHue?: number
  streamUrl?: string
  /** When set, the thumbnail becomes a button that fires this handler. */
  onThumbnailClick?: () => void
  /** When set, the title becomes a button that fires this handler. */
  onTitleClick?: () => void
  /** Fires on hover/focus/press so callers can warm data before open. */
  onThumbnailIntent?: () => void
  /** Fires on hover/focus/press over the title so callers can warm data. */
  onTitleIntent?: () => void
  /** Fires when hover-preview video playback is rejected by the browser. */
  onPreviewError?: (cause: unknown) => void
  /** Accessible label for the thumbnail button. */
  thumbnailLabel?: string
  /** Accessible label for the title button. */
  titleLabel?: string
  thumbnailRef?: React.Ref<HTMLButtonElement>
  metaVariant?: "default" | "showcase"
  /**
   * Floating controls over the thumbnail's top-right corner (e.g. an actions
   * menu). Rendered as a sibling of the thumbnail button, so interactive
   * elements stay valid HTML.
   */
  thumbnailOverlay?: React.ReactNode
}

type ClipCardLabelLinkProps = {
  href?: string
  className: string
  children: React.ReactNode
  onClick: React.MouseEventHandler<HTMLAnchorElement>
  ariaLabel?: string
}

type ClipCardLabelLinkRenderer = (
  props: ClipCardLabelLinkProps,
) => React.ReactNode

const HOVER_PREVIEW_DELAY_MS = 250

function ClipCard({
  className,
  title,
  titleContent,
  author,
  authorImage,
  authorInitials,
  authorAvatarBg,
  authorAvatarFg,
  authorHref,
  renderAuthorLink,
  game,
  gameIcon,
  gameHref,
  renderGameLink,
  views,
  viewCount,
  // Likes and comments stay in the contract but are no longer shown on the
  // card face — the meta line mirrors the channel-style "views · age" layout.
  likes: _likes,
  comments: _comments,
  postedAt = "2h ago",
  metaContent,
  thumbnail,
  thumbnailBlurHash,
  fallbackSeed,
  // Retained on the contract for callers; fallback color is now seed-driven.
  accentHue: _accentHue,
  streamUrl,
  onThumbnailClick,
  onTitleClick,
  onThumbnailIntent,
  onTitleIntent,
  onPreviewError,
  thumbnailLabel,
  titleLabel,
  thumbnailRef,
  metaVariant = "default",
  thumbnailOverlay,
  ...props
}: ClipCardProps) {
  const showAttributionRow = Boolean(author || game)

  return (
    <article
      data-slot="clip-card"
      className={cn("group/clip-card flex flex-col gap-1.5", className)}
      {...props}
    >
      <div className="relative">
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
        {thumbnailOverlay ? (
          <div className="absolute top-2 right-2 z-10">{thumbnailOverlay}</div>
        ) : null}
      </div>
      <div
        className={cn(
          "grid grid-rows-[auto_auto] gap-x-2",
          author
            ? "grid-cols-[auto_minmax(0,1fr)_auto]"
            : "grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        {author ? (
          <ClipCardAvatar
            author={author}
            authorImage={authorImage}
            authorInitials={authorInitials}
            authorAvatarBg={authorAvatarBg}
            authorAvatarFg={authorAvatarFg}
            href={authorHref}
            renderLink={renderAuthorLink}
            className="row-span-2 mt-0.5 size-9"
          />
        ) : null}
        <div className="text-foreground col-span-2 truncate text-lg leading-6 font-semibold">
          <ClipCardTitleButton
            title={title}
            label={titleLabel}
            onClick={onTitleClick}
            onIntent={onTitleIntent}
          >
            {titleContent ?? title}
          </ClipCardTitleButton>
        </div>
        {showAttributionRow ? (
          <div className="text-foreground-dim flex min-w-0 items-center gap-1.5 text-base leading-5">
            {author ? (
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <AuthorLabel
                  author={author}
                  href={authorHref}
                  renderLink={renderAuthorLink}
                />
                {game ? (
                  <>
                    <span className="text-foreground-faint shrink-0">
                      {"·"}
                    </span>
                    <GameLabel
                      game={game}
                      icon={gameIcon}
                      href={gameHref}
                      renderLink={renderGameLink}
                    />
                  </>
                ) : null}
              </span>
            ) : (
              <GameLabel
                game={game}
                icon={gameIcon}
                href={gameHref}
                renderLink={renderGameLink}
              />
            )}
          </div>
        ) : null}
        {metaVariant === "showcase" ? null : metaContent ? (
          <div className="text-foreground-faint flex min-w-0 items-center justify-end gap-1.5 text-sm leading-5 tabular-nums">
            {metaContent}
          </div>
        ) : (
          <div className="text-foreground-faint flex shrink-0 items-center justify-end gap-1.5 text-sm leading-5 tabular-nums">
            <span className="shrink-0">
              {views} {tp(viewCountForLabel(viewCount, views), "view", "views")}
            </span>
            <span className="shrink-0">{"·"}</span>
            <span className="shrink-0">{postedAt}</span>
          </div>
        )}
      </div>
    </article>
  )
}

function viewCountForLabel(
  viewCount: number | undefined,
  formattedViews: string,
): number {
  if (viewCount !== undefined) return viewCount
  return formattedViews.trim() === "1" ? 1 : 0
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
    // For cached thumbnails (e.g. navigating away from the library and back)
    // the <img> can already be `complete` by the time this mounts, so the
    // `load` event fires before React attaches `onLoad` and that handler
    // never runs. Seed the loaded state from the element itself so the still
    // shows instead of being stuck on the blurhash placeholder.
    const image = imageRef.current
    setThumbnailLoaded(Boolean(image?.complete && image.naturalWidth > 0))
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
    // One mask rounds the whole frame, so the still and the preview video share
    // identical corners — no per-element insets, no fringe, no shift.
    <div className={cn("absolute inset-0", CLIP_MEDIA_ROUNDED_CLASS)}>
      {fallback}

      {thumbnail && !thumbnailFailed ? (
        <img
          ref={imageRef}
          src={thumbnail}
          alt={title}
          className={cn(
            CLIP_MEDIA_CLASS,
            "transition-opacity duration-200 ease-out",
            // Keep the still fully opaque UNDER the preview video rather than
            // crossfading it out: fading both the still (out) and the video
            // (in) at once briefly exposes the blurhash placeholder beneath
            // them (1-(1-a)(1-b) reveal). The video, layered on top, simply
            // covers the still as it fades in.
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
  renderLink,
}: {
  author: string
  href: string | null | undefined
  renderLink: ClipCardLabelLinkRenderer | undefined
}) {
  const className = cn(
    "min-w-0 shrink truncate leading-5 font-medium text-foreground-muted",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none",
  )
  if (renderLink) {
    return renderLink({
      href: href ?? undefined,
      className,
      onClick: stopLabelLinkPropagation,
      children: author,
    })
  }
  if (href) {
    return (
      <a href={href} onClick={stopLabelLinkPropagation} className={className}>
        {author}
      </a>
    )
  }
  return <span className={className}>{author}</span>
}

function ClipCardAvatar({
  author,
  authorImage,
  authorInitials,
  authorAvatarBg,
  authorAvatarFg,
  href,
  renderLink,
  className,
}: {
  author: string
  authorImage: string | null | undefined
  authorInitials: string | undefined
  authorAvatarBg: string | undefined
  authorAvatarFg: string | undefined
  href: string | null | undefined
  renderLink: ClipCardLabelLinkRenderer | undefined
  className?: string
}) {
  const initials = authorInitials ?? (author.slice(0, 2).toUpperCase() || "?")
  const avatarStyle = {
    background: authorAvatarBg,
    color: authorAvatarFg,
  }

  const avatar = (
    <Avatar aria-hidden size="lg" className={className} style={avatarStyle}>
      {authorImage ? <AvatarImage src={authorImage} alt="" /> : null}
      <AvatarFallback style={avatarStyle}>{initials}</AvatarFallback>
    </Avatar>
  )

  const linkClassName = cn(
    className,
    "rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
  )

  if (renderLink) {
    return renderLink({
      href: href ?? undefined,
      className: linkClassName,
      onClick: stopLabelLinkPropagation,
      ariaLabel: author,
      children: avatar,
    })
  }

  if (href) {
    return (
      <a
        href={href}
        aria-label={author}
        onClick={stopLabelLinkPropagation}
        className={linkClassName}
      >
        {avatar}
      </a>
    )
  }

  return avatar
}

function ClipCardTitleButton({
  title,
  label,
  onClick,
  onIntent,
  children,
}: {
  title: string
  label: string | undefined
  onClick: (() => void) | undefined
  onIntent: (() => void) | undefined
  children: React.ReactNode
}) {
  if (!onClick) return children

  return (
    <button
      type="button"
      aria-label={label ?? title}
      className="block max-w-full truncate text-left hover:underline focus-visible:underline focus-visible:outline-none"
      onClick={onClick}
      onPointerEnter={onIntent}
      onFocus={onIntent}
    >
      {children}
    </button>
  )
}

function GameLabel({
  game,
  icon,
  href,
  renderLink,
}: {
  game: string
  icon: string | null | undefined
  href: string | null | undefined
  renderLink: ClipCardLabelLinkRenderer | undefined
}) {
  const className = cn(
    "inline-flex min-w-0 items-center gap-1.5 truncate leading-5 text-accent",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none",
  )
  const content = (
    <>
      <GameIcon src={icon} name={game} size="sm" />
      <span className="truncate">{game}</span>
    </>
  )
  if (renderLink) {
    return renderLink({
      href: href ?? undefined,
      className,
      onClick: stopLabelLinkPropagation,
      children: content,
    })
  }
  if (href) {
    return (
      <a href={href} onClick={stopLabelLinkPropagation} className={className}>
        {content}
      </a>
    )
  }
  return <span className={className}>{content}</span>
}

function stopLabelLinkPropagation(event: React.MouseEvent<HTMLAnchorElement>) {
  event.stopPropagation()
}

export {
  ClipCard,
  type ClipCardLabelLinkProps,
  type ClipCardLabelLinkRenderer,
  type ClipCardProps,
}
