import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { cn } from "@alloy/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import { Gamepad2Icon } from "lucide-react"
import type { ComponentProps } from "react"

const gameIconVariants = cva(
  "text-foreground-faint inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm",
  {
    variants: {
      size: {
        sm: "size-3.5",
        md: "size-4",
        lg: "size-5",
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

// Missing and broken artwork share a neutral fallback. Neither state paints
// a background, so wide logo slots don't become colored rectangles.
function GameIcon({ src, name, size, className, ...props }: GameIconProps) {
  const image = useImageLoaded(src)
  const ok = image.status !== "error"

  return (
    <span
      aria-hidden
      title={name}
      className={cn(gameIconVariants({ size }), className)}
      {...props}
      data-slot="game-icon"
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
        <Gamepad2Icon className="size-full max-h-8 max-w-8" aria-hidden />
      )}
    </span>
  )
}

export { GameIcon, type GameIconProps }
