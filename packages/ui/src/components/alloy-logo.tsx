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
      className={cn("inline-flex items-center leading-none", className)}
      style={{ gap: spacing }}
      {...props}
    >
      <AlloyLogoMark src={markSrc} size={size} />
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

function AlloyLogoMark({
  src = "/logo.png",
  size = 40,
  className,
  style,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { size?: number }) {
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={"alloy"}
      className={cn("block shrink-0 select-none", className)}
      style={{ width: size, height: size, ...style }}
      draggable={false}
      {...props}
    />
  )
}

export { AlloyLogo, AlloyLogoMark }
