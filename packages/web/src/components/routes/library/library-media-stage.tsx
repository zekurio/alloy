import { cn } from "@alloy/ui/lib/utils"
import type { CSSProperties, ReactNode } from "react"

export function LibraryMediaStage({
  children,
  className,
  aspectRatio,
}: {
  children: ReactNode
  className?: string
  aspectRatio?: number
}) {
  const frameStyle =
    aspectRatio && Number.isFinite(aspectRatio)
      ? ({ aspectRatio: String(aspectRatio) } satisfies CSSProperties)
      : undefined

  return (
    <div
      className={cn(
        "relative flex aspect-video w-full items-center justify-center overflow-hidden",
        "lg:min-h-0 lg:flex-1 lg:aspect-auto",
        className,
      )}
    >
      <div
        className="relative aspect-video w-full max-w-full lg:h-full lg:max-h-full lg:w-auto"
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
