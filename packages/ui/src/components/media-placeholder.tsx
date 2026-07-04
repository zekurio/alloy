import { blurHashAverageColor } from "@alloy/contracts/blurhash"
import { BlurHashCanvas } from "@alloy/ui/components/blurhash-canvas"
import { pastelMediaGradient } from "@alloy/ui/lib/pastel"
import { cn } from "@alloy/ui/lib/utils"

export function MediaPlaceholder({
  seed,
  blurHash,
  aspectRatio,
  className,
}: {
  seed: string | number
  blurHash?: string | null
  /**
   * Known media aspect ratio. When set, the blurhash letterboxes to that
   * shape over the gradient backdrop instead of stretching across a frame
   * that may not match the media.
   */
  aspectRatio?: number
  className?: string
}) {
  const averageColor = blurHash ? blurHashAverageColor(blurHash) : null

  return (
    <div
      aria-hidden
      className={cn("absolute inset-0", className)}
      style={{ background: averageColor ?? pastelMediaGradient(seed) }}
    >
      <BlurHashCanvas hash={blurHash} aspectRatio={aspectRatio} />
    </div>
  )
}
