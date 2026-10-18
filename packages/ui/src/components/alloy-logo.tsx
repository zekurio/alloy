import { cn } from "@alloy/ui/lib/utils"
import type { HTMLAttributes } from "react"

interface AlloyLogoProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number
  showText?: boolean
  textClassName?: string
  spacing?: number
}

function AlloyLogo({
  size = 40,
  showText = false,
  textClassName,
  spacing = 10,
  className,
  ...props
}: AlloyLogoProps) {
  if (!showText) {
    return <AlloyLogoMark size={size} className={className} {...props} />
  }

  return (
    <span
      className={cn("inline-flex items-center leading-none", className)}
      style={{ gap: spacing }}
      {...props}
    >
      <AlloyLogoMark size={size} />
      <span
        className={cn(
          "font-mono inline-flex items-center font-bold tracking-normal text-foreground",
          textClassName,
        )}
        style={{
          fontSize: Math.round(size * 0.56),
          lineHeight: `${size}px`,
        }}
      >
        {"alloy"}
      </span>
    </span>
  )
}

// Glyph only, tinted with the theme accent; public/logo.svg adds a backdrop
// for icon contexts.
function AlloyLogoMark({
  size = 40,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { size?: number }) {
  return (
    <span
      role="img"
      aria-label={"alloy"}
      className={cn("block shrink-0 text-accent select-none", className)}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <AlloyMarkFigure className="block size-full" />
    </span>
  )
}

function AlloyMarkFigure({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-20.29 -18.29 292.57 292.57"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={14}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M32 160 L55 220 L157 172 L220 66 L163 36 L105 72 Z" />
      <path d="M32 160 L98 127 L157 172 M98 127 L163 36" />
    </svg>
  )
}

export { AlloyLogo }
