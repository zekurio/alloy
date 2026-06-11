import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

interface AlloyLogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: number
  showText?: boolean
  markSrc?: string
  textClassName?: string
  spacing?: number
}

function AlloyLogo({
  size = 40,
  showText = false,
  markSrc,
  textClassName,
  spacing = 10,
  className,
  ...props
}: AlloyLogoProps) {
  if (!showText) {
    return <AlloyLogoMark src={markSrc} size={size} className={className} />
  }

  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={{ gap: spacing }}
      {...props}
    >
      <AlloyLogoMark src={markSrc} size={size} />
      <span
        className={cn(
          "font-mono leading-none font-bold tracking-normal text-foreground",
          textClassName,
        )}
        style={{ fontSize: Math.round(size * 0.56) }}
      >
        alloy
      </span>
    </span>
  )
}

function AlloyLogoMark({
  src = "/logo.png",
  size = 40,
  className,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { size?: number }) {
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="alloy"
      className={cn("shrink-0 select-none", className)}
      draggable={false}
      {...props}
    />
  )
}

export { AlloyLogo, AlloyLogoMark }
