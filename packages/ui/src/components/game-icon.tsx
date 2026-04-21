import * as React from "react"
import { cva } from "class-variance-authority"
import type { VariantProps } from "class-variance-authority"

import { cn } from "@workspace/ui/lib/utils"

const gameIconVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm",
    "bg-surface-muted font-mono text-foreground-faint uppercase"
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
  }
)

interface GameIconProps
  extends
    Omit<React.ComponentProps<"span">, "children">,
    VariantProps<typeof gameIconVariants> {
  src: string | null | undefined
  name: string
}

// SGDB occasionally hands back a URL that 404s; fall back to the first
// letter in a monospace badge on error.
function GameIcon({ src, name, size, className, ...props }: GameIconProps) {
  const [ok, setOk] = React.useState(src != null)
  return (
    <span
      aria-hidden
      className={cn(gameIconVariants({ size }), className)}
      {...props}
    >
      {src && ok ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          onError={() => setOk(false)}
        />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  )
}

export { GameIcon, type GameIconProps }
