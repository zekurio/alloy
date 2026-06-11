import { cn } from "@alloy/ui/lib/utils"

import { userImageSrc } from "@/lib/user-display"

/**
 * Full-bleed custom profile wallpaper. Fills the whole page behind the floating
 * profile card so its colors show in the margins and bleed through the card's
 * frosted body. Only a light scrim is applied — the card supplies its own
 * contrast — so the wallpaper stays vibrant. Renders nothing (falling back to
 * the page's `bg-surface-sunken`) when the user has no background set.
 */
export function ProfileBackground({
  src,
  className,
}: {
  src: string | null | undefined
  className?: string
}) {
  const resolved = userImageSrc(src)
  if (!resolved) return null

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      <img
        src={resolved}
        alt=""
        decoding="async"
        className="absolute inset-0 size-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-black/20" />
    </div>
  )
}
