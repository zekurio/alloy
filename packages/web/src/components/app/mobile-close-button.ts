import { cn } from "@alloy/ui/lib/utils"

const mobileCloseIconClassName = "size-5"

const mobileSurfaceCloseButtonClassName = cn(
  "inline-flex size-9 items-center justify-center rounded-md",
  "text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
  "[&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
)

const mobileOverlayCloseButtonClassName = cn(
  "inline-flex size-9 items-center justify-center rounded-full",
  "text-white/85 transition-colors hover:bg-white/10 hover:text-white",
  "focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-0 focus-visible:outline-none",
  "[&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
)

export {
  mobileCloseIconClassName,
  mobileOverlayCloseButtonClassName,
  mobileSurfaceCloseButtonClassName,
}
