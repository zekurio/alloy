import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy Avatar — square-with-rounded-corner, sizes sm/md/lg/xl.
 * The handoff uses rounded squares (var(--radius)) rather than full circles
 * to pair nicely with the monospaced numerical identity tags.
 */
function Avatar({
  className,
  size = "md",
  ring = false,
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "sm" | "md" | "lg" | "xl"
  ring?: boolean
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-ring={ring || undefined}
      className={cn(
        "group/avatar relative inline-flex shrink-0 select-none overflow-hidden",
        "items-center justify-center rounded-md bg-neutral-200 text-foreground font-semibold",
        "data-[size=sm]:size-5 data-[size=sm]:text-[9px]",
        "data-[size=md]:size-7 data-[size=md]:text-[11px]",
        "data-[size=lg]:size-9 data-[size=lg]:text-[13px]",
        "data-[size=xl]:size-12 data-[size=xl]:text-[16px]",
        "data-[ring=true]:shadow-[0_0_0_1.5px_var(--background),0_0_0_3px_var(--accent)]",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("size-full object-cover", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center leading-none",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2",
        "group-data-[size=md]/avatar:size-2.5",
        "group-data-[size=lg]/avatar:size-3",
        "group-data-[size=xl]/avatar:size-3.5",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-md bg-surface-raised text-foreground-muted ring-2 ring-background select-none",
        "size-7 text-[10px] group-has-data-[size=lg]/avatar-group:size-9 group-has-data-[size=sm]/avatar-group:size-5 group-has-data-[size=xl]/avatar-group:size-12",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
}
