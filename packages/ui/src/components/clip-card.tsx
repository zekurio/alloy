import * as React from "react"
import {
  EyeIcon,
  HeartIcon,
  LinkIcon,
  LockIcon,
  MessageSquareIcon,
} from "lucide-react"

import { GameIcon } from "@workspace/ui/components/game-icon"
import { cn } from "@workspace/ui/lib/utils"

interface ClipCardProps extends React.ComponentProps<"article"> {
  title: string
  author: string
  authorSeed?: string
  authorImage?: string | null
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
  /** Accessible label for the thumbnail button. */
  thumbnailLabel?: string
  thumbnailRef?: React.Ref<HTMLButtonElement>
}

const HOVER_PREVIEW_DELAY_MS = 250

function ClipCard({
  className,
  title,
  author,
  authorSeed,
  authorImage,
  authorHref,
  game,
  gameIcon,
  gameHref,
  views,
  likes,
  comments,
  postedAt = "2h ago",
  thumbnail,
  accentHue,
  streamUrl,
  privacy,
  onThumbnailClick,
  thumbnailLabel,
  thumbnailRef,
  ...props
}: ClipCardProps) {
  const commentCount =
    comments ?? Math.max(0, Math.floor((Number.parseFloat(likes) || 0) / 8))

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
        label={thumbnailLabel ?? title}
        buttonRef={thumbnailRef}
      />
      <div className="flex flex-col gap-2">
        <div className="truncate text-lg font-semibold tracking-[-0.015em] text-foreground">
          {title}
        </div>
        {author ? (
          <div className="flex min-w-0 items-center gap-2 text-md leading-none text-foreground-dim">
            <ClipCardAvatar
              author={author}
              authorSeed={authorSeed}
              authorImage={authorImage}
            />
            <span className="flex min-w-0 -translate-y-px items-center gap-2">
              <AuthorLabel author={author} href={authorHref} />
              <span className="shrink-0 text-foreground-faint">·</span>
              <GameLabel game={game} icon={gameIcon} href={gameHref} />
            </span>
          </div>
        ) : (
          <div className="text-md text-accent">
            <GameLabel game={game} icon={gameIcon} href={gameHref} />
          </div>
        )}
        <div className="flex items-center gap-3.5 font-mono text-sm tracking-[0.04em] text-foreground-faint">
          <span className="inline-flex items-center gap-1.5">
            <EyeIcon className="size-3.5" />
            {views}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <HeartIcon className="size-3.5" />
            {likes}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessageSquareIcon className="size-3.5" />
            {commentCount}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            {privacyBadge}
            {postedAt}
          </span>
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
  label,
  buttonRef,
}: {
  title: string
  thumbnail: string | undefined
  accentHue: number | undefined
  streamUrl: string | undefined
  onClick?: () => void
  label?: string
  buttonRef?: React.Ref<HTMLButtonElement>
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const timerRef = React.useRef<number | null>(null)
  const [previewing, setPreviewing] = React.useState(false)

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

  const schedulePreview = () => {
    if (!canPreview) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setPreviewing(true)
      const v = videoRef.current
      if (v) {
        v.currentTime = 0
        // `play()` rejects when the tab is backgrounded or the user
        // navigates mid-hover. Swallow — we'll never show the preview
        // and the thumbnail stays visible.
        void v.play().catch(() => undefined)
      }
    }, HOVER_PREVIEW_DELAY_MS)
  }

  const cancelPreview = () => {
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
    "group/clip-thumb relative aspect-video w-full overflow-hidden rounded-md bg-neutral-200 text-left",
    "transition-[transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    interactive &&
      "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
  )
  const hoverHandlers = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return
      schedulePreview()
    },
    onPointerLeave: cancelPreview,
  }

  const body = (
    <>
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={title}
          className="size-full object-cover"
          // Cards load in a scrolling grid — let the browser lazy-load
          // anything outside the initial viewport.
          loading="lazy"
          decoding="async"
        />
      ) : accentHue !== undefined ? (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, oklch(0.3 0.1 ${accentHue}) 0%, oklch(0.15 0.05 ${accentHue}) 70%, oklch(0.08 0 0) 100%)`,
          }}
        />
      ) : (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 grid place-items-center",
            "font-mono text-2xs tracking-[0.1em] text-foreground-faint uppercase"
          )}
          style={{
            background:
              "repeating-linear-gradient(45deg, oklch(0.18 0 0) 0 8px, oklch(0.16 0 0) 8px 16px)",
          }}
        >
          clip preview
        </div>
      )}

      {/* Hover preview overlay. Mounted only when we actually have a
          stream URL — keeps the DOM light for mock decks and
          still-encoding rows. `use-credentials` so private clips
          carry better-auth's cookie for the range GET. */}
      {canPreview ? (
        <video
          ref={videoRef}
          src={streamUrl}
          muted
          loop
          playsInline
          preload="none"
          crossOrigin="use-credentials"
          aria-hidden
          className={cn(
            "absolute inset-0 size-full bg-black object-cover",
            "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            previewing ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        />
      ) : null}
    </>
  )

  if (interactive) {
    return (
      <button
        type="button"
        ref={buttonRef}
        onClick={onClick}
        aria-label={label}
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

function AuthorLabel({
  author,
  href,
}: {
  author: string
  href: string | null | undefined
}) {
  const className = cn(
    "truncate leading-none font-medium text-foreground-muted",
    href &&
      "hover:underline focus-visible:underline focus-visible:outline-none"
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
}: {
  author: string
  authorSeed: string | undefined
  authorImage: string | null | undefined
}) {
  const initials = author.slice(0, 2).toUpperCase() || "?"
  const seed = authorSeed || author || "user"
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[3px]",
        "text-[9px] leading-none font-semibold"
      )}
      style={{
        background: `oklch(0.32 0.18 ${hue})`,
        color: `oklch(0.92 0.1 ${hue})`,
      }}
    >
      {authorImage ? (
        <img
          src={authorImage}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
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
    "inline-flex min-w-0 items-center gap-1.5 truncate leading-none text-accent",
    href && "hover:underline focus-visible:underline focus-visible:outline-none"
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
  privacy: ClipCardProps["privacy"]
): React.ReactNode {
  if (!privacy || privacy === "public") return null
  const Icon = privacy === "private" ? LockIcon : LinkIcon
  const label =
    privacy === "private" ? "Private — only you" : "Unlisted — only via link"
  return (
    <span
      className="inline-flex items-center text-foreground-faint"
      title={label}
      aria-label={label}
    >
      <Icon className="size-3.5" aria-hidden />
    </span>
  )
}

export { ClipCard, type ClipCardProps }
