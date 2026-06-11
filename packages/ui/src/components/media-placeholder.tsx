import { BlurHashCanvas } from "@alloy/ui/components/blurhash-canvas"
import { pastelMediaGradient } from "@alloy/ui/lib/pastel"
import { cn } from "@alloy/ui/lib/utils"

export function MediaPlaceholder({
  seed,
  blurHash,
  className,
}: {
  seed: string | number
  blurHash?: string | null
  className?: string
}) {
  return (
    <div
      aria-hidden
      className={cn("absolute inset-0", className)}
      style={{ background: pastelMediaGradient(seed) }}
    >
      <BlurHashCanvas hash={blurHash} />
    </div>
  )
}
