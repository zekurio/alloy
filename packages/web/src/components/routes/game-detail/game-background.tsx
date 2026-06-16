import { cn } from "@alloy/ui/lib/utils"

/**
 * Full-bleed game wallpaper built from the hero art. The same image doubles as
 * the sharp banner at the top of the card, so here it is heavily blurred and
 * darkened — an ambient wash that tints the margins and bleeds through the
 * frosted card without competing with the crisp banner. Renders nothing (the
 * page falls back to `bg-surface`) when the game has no hero.
 */
export function GameBackground({
  heroUrl,
  className,
}: {
  heroUrl: string | null | undefined
  className?: string
}) {
  if (!heroUrl) return null

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {/* scale-110 hides the soft edges the blur pulls in from the frame. */}
      <img
        src={heroUrl}
        alt=""
        decoding="async"
        className="absolute inset-0 size-full scale-110 object-cover object-center blur-2xl"
      />
      <div className="absolute inset-0 bg-black/45" />
    </div>
  )
}
