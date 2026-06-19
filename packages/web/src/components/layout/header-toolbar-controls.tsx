import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps, ReactNode } from "react"

type HeaderToolbarControlsOptions = {
  desktop: ReactNode
  mobile: ReactNode
  className?: string
  mobileClassName?: string
}

export function createHeaderToolbarControls({
  desktop,
  mobile,
  className,
  mobileClassName,
}: HeaderToolbarControlsOptions) {
  return {
    desktop: (
      <HeaderToolbarControls className={className}>
        {desktop}
      </HeaderToolbarControls>
    ),
    mobile: (
      <HeaderToolbarControls className={cn(className, mobileClassName)}>
        {mobile}
      </HeaderToolbarControls>
    ),
  }
}

export function HeaderToolbarControls({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...props}
    />
  )
}
