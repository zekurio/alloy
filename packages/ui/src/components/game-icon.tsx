import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { pastelAvatarColors } from "@alloy/ui/lib/pastel"
import { cn } from "@alloy/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

const gameIconVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm",
    // No backing fill here: a loaded icon supplies its own pixels, and leaving
    // the box transparent lets icons with rounded/transparent corners blend
    // into the surface instead of showing a faint lighter frame. The pastel
    // fallback below paints its own background when there is no icon.
    "font-mono leading-3 text-foreground-faint uppercase",
  ),
  {
    variants: {
      size: {
        sm: "size-3.5 text-[9px]",
        md: "size-4 text-[10px]",
        lg: "size-5 text-[11px]",
      },
    },
    defaultVariants: { size: "md" },
  },
)

interface GameIconProps
  extends
    Omit<ComponentProps<"span">, "children">,
    VariantProps<typeof gameIconVariants> {
  src: string | null | undefined
  name: string
}

// steamgriddb occasionally hands back a URL that 404s; fall back to the first
// letter in a monospace badge on error.
function GameIcon({
  src,
  name,
  size,
  className,
  style,
  ...props
}: GameIconProps) {
  const image = useImageLoaded(src)
  const ok = image.status !== "error"
  const fallbackColors = pastelAvatarColors(name)
  const fallbackStyle =
    ok && src
      ? style
      : { background: fallbackColors.bg, color: fallbackColors.fg, ...style }

  return (
    <span
      aria-hidden
      className={cn(gameIconVariants({ size }), className)}
      style={fallbackStyle}
      {...props}
    >
      {src && ok ? (
        <img
          ref={image.ref}
          src={src}
          alt=""
          className="block size-full object-contain"
          onLoad={image.markLoaded}
          onError={image.markError}
        />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  )
}

export { GameIcon, type GameIconProps }
