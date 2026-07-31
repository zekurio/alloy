import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps } from "react"

/**
 * Checkerboard used behind translucent colours so alpha is visible rather than
 * blending into whatever the swatch happens to sit on.
 */
const ALPHA_CHECKERBOARD =
  "repeating-conic-gradient(oklch(0.5 0 0 / 0.35) 0% 25%, transparent 0% 50%) 50% / 8px 8px"

/**
 * Renders any CSS colour by handing the string straight to the browser, so
 * `oklch()`, `color-mix()`, and keywords preview correctly without the app
 * having to understand them.
 */
export function ColorSwatch({
  color,
  className,
  ...props
}: Omit<ComponentProps<"span">, "color"> & { color: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "border-border relative block size-full overflow-hidden rounded-md border",
        className,
      )}
      style={{ background: ALPHA_CHECKERBOARD }}
      {...props}
    >
      <span className="absolute inset-0" style={{ background: color }} />
    </span>
  )
}
