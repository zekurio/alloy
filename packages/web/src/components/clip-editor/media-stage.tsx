import { cn } from "@alloy/ui/lib/utils"
import type { CSSProperties, ReactNode } from "react"

export function MediaStage({
  children,
  className,
  aspectRatio,
  maxHeight,
}: {
  children: ReactNode
  className?: string
  aspectRatio?: number
  /**
   * Caps the frame's height (e.g. `"38dvh"`), narrowing it to keep the aspect
   * ratio instead of letterboxing. Without it the frame is width-driven.
   */
  maxHeight?: string
}) {
  const ratio =
    aspectRatio && Number.isFinite(aspectRatio) ? aspectRatio : 16 / 9
  const frameStyle = {
    aspectRatio: String(ratio),
    ...(maxHeight
      ? { maxHeight, width: `min(100%, calc(${maxHeight} * ${ratio}))` }
      : {}),
  } satisfies CSSProperties

  return (
    <div
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden",
        // A capped frame sizes the stage; otherwise the stage reserves the
        // media box up front so the poster doesn't shift the page on load.
        maxHeight ? "min-h-0" : "aspect-video",
        "lg:min-h-0 lg:flex-1 lg:aspect-auto",
        className,
      )}
    >
      <div
        className="relative w-full max-w-full lg:h-full lg:max-h-full lg:w-auto"
        style={frameStyle}
      >
        {children}
      </div>
    </div>
  )
}

export function mediaAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined,
): number {
  return width && height && width > 0 && height > 0 ? width / height : 16 / 9
}
