import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

interface AlloyLogoProps extends React.HTMLAttributes<HTMLSpanElement> {
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
    return <AlloyLogoMark size={size} className={className} />
  }

  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={{ gap: spacing }}
      {...props}
    >
      <AlloyLogoMark size={size} />
      <span
        className={cn(
          "font-semibold tracking-[-0.02em] text-foreground",
          textClassName
        )}
        style={{ fontSize: Math.round(size * 0.48) }}
      >
        alloy
      </span>
    </span>
  )
}

function AlloyLogoMark({
  size = 40,
  className,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { size?: number }) {
  return (
    <img
      src="/alloy-logo.png"
      width={size}
      height={size}
      alt="Alloy"
      className={cn("shrink-0 select-none", className)}
      draggable={false}
      {...props}
    />
  )
}

export { AlloyLogo, AlloyLogoMark }
