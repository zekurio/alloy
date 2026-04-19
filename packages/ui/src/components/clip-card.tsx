import * as React from "react"
import { EyeIcon, HeartIcon, MessageSquareIcon } from "lucide-react"

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
  game: string
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
}

// Delay before hover-to-play kicks in. Short enough to feel responsive
// when the user actually stops on a card, long enough to ignore casual
// passthroughs during a diagonal cursor sweep.
const HOVER_PREVIEW_DELAY_MS = 250

function ClipCard({
  className,
  title,
  author,
  game,
  views,
  likes,
  comments,
  postedAt = "2h ago",
  thumbnail,
  accentHue,
  streamUrl,
  ...props
}: ClipCardProps) {
  const commentCount =
    comments ?? Math.max(0, Math.floor((Number.parseFloat(likes) || 0) / 8))

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
          <div className="flex min-w-0 items-center gap-1.5 text-md text-foreground-dim">
            <span className="truncate font-medium text-foreground-muted">
              {author}
            </span>
            <span className="text-foreground-faint">·</span>
            <span className="truncate text-accent">{game}</span>
          </div>
        ) : (
          <div className="text-md text-accent">{game}</div>
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
          <span className="ml-auto">{postedAt}</span>
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

export { ClipCard, type ClipCardProps }
