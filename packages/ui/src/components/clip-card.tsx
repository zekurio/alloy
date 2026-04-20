import * as React from "react"
import {
  EyeIcon,
  HeartIcon,
  LinkIcon,
  LockIcon,
  MessageSquareIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy ClipCard — the core browsing primitive. A rounded 16:9 thumbnail
 * with the metadata floating directly beneath it (no card container, no
 * border, no surface fill).
 *
 * Thumbnail sources:
 *   - pass `thumbnail` for a real image URL (preferred when the row has a
 *     `thumbKey` — falls back to the gradient placeholder otherwise)
 *   - pass `accentHue` (0–360) for a gradient placeholder tinted to the
 *     clip's game colour
 *   - neither → diagonal-stripe "clip preview" placeholder
 *
 * Hover-to-play:
 *   - pass `streamUrl` to have the card fade in a muted looped `<video>`
 *     250ms after the pointer enters the thumbnail. The delay prevents a
 *     flurry of range-GETs when the user drags the cursor across a grid.
 *     Pointer-leave pauses and fades the video out, the thumbnail shows
 *     through again. Mobile (no-hover media query) skips the preview
 *     entirely — the user's tap opens the player anyway.
 *
 * `comments` is optional — if omitted, it's estimated from `likes` so a
 * bare `{views, likes}` call still renders a full stats row.
 */
interface ClipCardProps extends React.ComponentProps<"article"> {
  title: string
  author: string
  /**
   * Uploader avatar URL. When omitted (or null), a tinted monogram square
   * stands in so the row still reads as an identity. The card keeps the
   * avatar small (20px) — it's an aside to the title, not the subject.
   */
  authorImage?: string | null
  game: string
  /**
   * Destination for the game label when the clip is mapped to a SGDB
   * game. When set, the label becomes an anchor that opens `/g/:slug`;
   * when null/omitted (legacy text-only rows) the label stays a plain
   * span so viewers don't see a broken link. The card keeps this as a
   * plain string so `@workspace/ui` doesn't reach into the app's
   * router; the caller supplies the already-built href.
   */
  gameHref?: string | null
  views: string
  likes: string
  comments?: string | number
  postedAt?: string
  thumbnail?: string
  accentHue?: number
  /**
   * Direct stream URL for the hover-to-play preview. Optional — when
   * omitted the card renders as a pure thumbnail (useful for mock feeds
   * and still-encoding clips where no stream is ready yet).
   */
  streamUrl?: string
  /**
   * Privacy setting to surface on the card. Only passed by the clip's
   * owner — public viewers never see this. A `"public"` value renders
   * nothing (public is the default state and doesn't need a marker);
   * `"unlisted"` and `"private"` render a small, low-contrast icon next
   * to `postedAt` as a quiet reminder of the clip's visibility.
   */
  privacy?: "public" | "unlisted" | "private"
}

// Delay before hover-to-play kicks in. Short enough to feel responsive
// when the user actually stops on a card, long enough to ignore casual
// passthroughs during a diagonal cursor sweep.
const HOVER_PREVIEW_DELAY_MS = 250

function ClipCard({
  className,
  title,
  author,
  authorImage,
  game,
  gameHref,
  views,
  likes,
  comments,
  postedAt = "2h ago",
  thumbnail,
  accentHue,
  streamUrl,
  privacy,
  ...props
}: ClipCardProps) {
  const commentCount =
    comments ?? Math.max(0, Math.floor((Number.parseFloat(likes) || 0) / 8))

  const privacyBadge = renderPrivacyBadge(privacy)

  return (
    <article
      data-slot="clip-card"
      className={cn(
        "group/clip-card flex cursor-pointer flex-col gap-3",
        className
      )}
      {...props}
    >
      <ClipCardThumb
        title={title}
        thumbnail={thumbnail}
        accentHue={accentHue}
        streamUrl={streamUrl}
      />
      <div className="flex flex-col gap-2">
        <div className="truncate text-lg font-semibold tracking-[-0.015em] text-foreground">
          {title}
        </div>
        {author ? (
          <div className="flex min-w-0 items-center gap-2 text-md leading-none text-foreground-dim">
            <ClipCardAvatar author={author} authorImage={authorImage} />
            {/* Optical nudge: apply a single -1px lift to the entire text
                cluster so author, separator, and game label share the
                exact same baseline shift relative to the avatar. */}
            <span className="flex min-w-0 -translate-y-px items-center gap-2">
              <span className="truncate leading-none font-medium text-foreground-muted">
                {author}
              </span>
              <span className="shrink-0 text-foreground-faint">·</span>
              <GameLabel game={game} href={gameHref} />
            </span>
          </div>
        ) : (
          <div className="text-md text-accent">
            <GameLabel game={game} href={gameHref} />
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

/**
 * The 16:9 thumbnail surface. Factored out so the hover-to-play effect
 * machinery (timer ref, video ref, fade state) only mounts on the
 * component that actually needs it — the meta row underneath stays a
 * pure presentational block.
 */
function ClipCardThumb({
  title,
  thumbnail,
  accentHue,
  streamUrl,
}: {
  title: string
  thumbnail: string | undefined
  accentHue: number | undefined
  streamUrl: string | undefined
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

  return (
    <div
      className={cn(
        "relative aspect-video overflow-hidden rounded-md bg-neutral-200",
        "transition-[transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
      )}
      onPointerEnter={(e) => {
        // Skip the preview on touch — a tap would otherwise fire the
        // hover path before the parent's onClick navigates.
        if (e.pointerType === "touch") return
        schedulePreview()
      }}
      onPointerLeave={cancelPreview}
    >
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
    </div>
  )
}

/**
 * 20px identity square next to the author name. Mirrors the tinted-fallback
 * approach from `UserChip` so every author reads as a distinct face even
 * when `user.image` is null. Kept local to the card so the UI package
 * stays free of a user-display helper dependency — the tint comes from a
 * cheap hash of the handle itself.
 */
function ClipCardAvatar({
  author,
  authorImage,
}: {
  author: string
  authorImage: string | null | undefined
}) {
  const initials = author.slice(0, 2).toUpperCase() || "?"
  // Deterministic hue per handle so the same user always gets the same
  // tint across the grid. Matches the spirit of `avatarTint` in the app
  // without pulling it across the package boundary.
  let hash = 0
  for (let i = 0; i < author.length; i++) {
    hash = (hash * 31 + author.charCodeAt(i)) >>> 0
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

/**
 * Game badge in the card's meta row. When the caller supplies `href` —
 * i.e. the clip is mapped to a real SGDB game row — the label becomes an
 * anchor pointing at `/g/:slug`; otherwise it stays a plain span so legacy
 * text-only rows don't flash a "link but nowhere to go" underline on hover.
 *
 * We stop click propagation so the anchor's navigation doesn't also fire
 * the parent `ClipCardTrigger`'s dialog-open handler — a click on the
 * game label should take the viewer to the game page, not cascade into
 * opening the clip player.
 */
function GameLabel({
  game,
  href,
}: {
  game: string
  href: string | null | undefined
}) {
  const className = cn(
    "truncate leading-none text-accent",
    href && "hover:underline focus-visible:underline focus-visible:outline-none"
  )
  if (href) {
    return (
      <a href={href} onClick={(e) => e.stopPropagation()} className={className}>
        {game}
      </a>
    )
  }
  return <span className={className}>{game}</span>
}

/**
 * Subtle visibility indicator the owner sees on their own clips. Public
 * clips render nothing — the absence of a badge reads as "public" without
 * adding an extra glyph to every card in the feed. Unlisted gets a link
 * icon (shareable-by-URL), private gets a lock. Both inherit the stats
 * row's muted colour so they whisper rather than shout.
 */
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
