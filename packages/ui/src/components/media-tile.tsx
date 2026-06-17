import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

type MediaTileProps = Omit<React.ComponentProps<"button">, "title"> & {
  /** Cover image shown behind the overlay. */
  imageUrl?: string | null
  /** Centered glyph above the label (e.g. a play badge or icon). */
  icon?: React.ReactNode
  /** Primary label, e.g. "Watch Trailer". */
  label: string
  /** Secondary line, e.g. "4 screenshots" / "10 clips". */
  caption?: string
  /** Aspect ratio of the tile. */
  aspect?: "video" | "square"
  /** Render layered cards behind the tile to suggest a stacked deck. */
  stacked?: boolean
}

/**
 * Clickable media preview tile: a cover image under a dark scrim with a
 * centered icon + label. Shared by the game header's trailer, screenshots, and
 * clips-of-the-week cards. Forwards its ref/props so it can be used directly as
 * a dialog or link trigger (`render={<MediaTile … />}`).
 */
export const MediaTile = React.forwardRef<HTMLButtonElement, MediaTileProps>(
  function MediaTile(
    {
      imageUrl,
      icon,
      label,
      caption,
      aspect = "video",
      stacked = false,
      className,
      children,
      ...props
    },
    ref,
  ) {
    const button = (
      <button
        ref={ref}
        type="button"
        className={cn(
          "group/media-tile relative flex w-full items-center justify-center overflow-hidden rounded-xl",
          "border-border bg-surface-sunken text-foreground border",
          "transition-colors hover:border-border-strong",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          aspect === "video" ? "aspect-video" : "aspect-square",
          !stacked && className,
        )}
        {...props}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            decoding="async"
            className="absolute inset-0 size-full object-cover opacity-85 transition-opacity group-hover/media-tile:opacity-100"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
        <div className="relative flex flex-col items-center gap-1.5 px-2 text-center">
          {icon}
          <span className="text-sm font-semibold text-white drop-shadow">
            {label}
          </span>
          {caption ? (
            <span className="text-2xs font-medium text-white/75 drop-shadow">
              {caption}
            </span>
          ) : null}
        </div>
        {children}
      </button>
    )

    if (!stacked) return button

    // Layered cards behind the tile to suggest a deck (clips-of-the-week).
    return (
      <div className={cn("relative pt-2.5", className)}>
        <div
          aria-hidden
          className="border-border/40 bg-surface-raised/50 absolute inset-x-6 top-0 h-5 rounded-t-xl border"
        />
        <div
          aria-hidden
          className="border-border/60 bg-surface-raised/80 absolute inset-x-3 top-1.5 h-5 rounded-t-xl border"
        />
        <div className="relative">{button}</div>
      </div>
    )
  },
)
