import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "@workspace/ui/lib/utils"

const avatarRootSizeClasses = [
  "data-[size=sm]:size-5 data-[size=sm]:text-[9px] data-[size=sm]:leading-3",
  "data-[size=md]:size-7 data-[size=md]:text-[11px] data-[size=md]:leading-4",
  "data-[size=lg]:size-9 data-[size=lg]:text-[13px] data-[size=lg]:leading-4",
  "data-[size=xl]:size-12 data-[size=xl]:text-[16px] data-[size=xl]:leading-5",
  "data-[size=2xl]:size-24 data-[size=2xl]:rounded-lg data-[size=2xl]:text-[28px] data-[size=2xl]:leading-9",
]

const avatarBadgeSizeClasses = [
  "group-data-[size=sm]/avatar:size-2",
  "group-data-[size=md]/avatar:size-2.5",
  "group-data-[size=lg]/avatar:size-3",
  "group-data-[size=xl]/avatar:size-3.5",
  "group-data-[size=2xl]/avatar:size-5",
]

const loadedAvatarImageSrcs = new Set<string>()

function getAvatarImageKey(children: React.ReactNode): string {
  let imageKey = "fallback"

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return

    if (child.type === AvatarImage) {
      const src = (child.props as { src?: unknown }).src
      imageKey = typeof src === "string" && src ? src : "fallback"
      return
    }

    const nestedChildren = (child.props as { children?: React.ReactNode })
      .children
    if (nestedChildren !== undefined) {
      const nestedKey = getAvatarImageKey(nestedChildren)
      if (nestedKey !== "fallback") imageKey = nestedKey
    }
  })

  return imageKey
}

function Avatar({
  className,
  size = "md",
  ring = false,
  children,
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "sm" | "md" | "lg" | "xl" | "2xl"
  ring?: boolean
}) {
  const imageKey = getAvatarImageKey(children)

  return (
    <AvatarPrimitive.Root
      key={imageKey}
      data-slot="avatar"
      data-size={size}
      data-ring={ring || undefined}
      className={cn(
        "group/avatar relative inline-flex shrink-0 overflow-hidden select-none",
        "items-center justify-center rounded-md bg-neutral-200 font-semibold text-foreground",
        ...avatarRootSizeClasses,
        "data-[ring=true]:shadow-[0_0_0_1.5px_var(--background),0_0_0_3px_var(--accent)]",
        className
      )}
      {...props}
    >
      {children}
    </AvatarPrimitive.Root>
  )
}

function AvatarImage({
  className,
  src,
  onLoadingStatusChange,
  ...props
}: AvatarPrimitive.Image.Props) {
  const initialStatus = src
    ? loadedAvatarImageSrcs.has(src)
      ? "loaded"
      : "loading"
    : "idle"
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "loaded" | "error"
  >(initialStatus)

  React.useEffect(() => {
    setStatus(
      src ? (loadedAvatarImageSrcs.has(src) ? "loaded" : "loading") : "idle"
    )
  }, [src])

  const showLoadingMask = !!src && status !== "loaded" && status !== "error"

  return (
    <>
      <AvatarPrimitive.Image
        data-slot="avatar-image"
        src={src}
        onLoadingStatusChange={(nextStatus) => {
          if (src && nextStatus === "loaded") {
            loadedAvatarImageSrcs.add(src)
          }
          setStatus(nextStatus)
          onLoadingStatusChange?.(nextStatus)
        }}
        className={cn("size-full object-cover", className)}
        {...props}
      />
      {showLoadingMask ? (
        <span
          aria-hidden
          data-slot="avatar-image-loading"
          className="absolute inset-0 z-10 bg-muted"
        />
      ) : null}
    </>
  )
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn("flex size-full items-center justify-center", className)}
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
        ...avatarBadgeSizeClasses,
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
        "size-7 text-[10px] leading-3 group-has-data-[size=lg]/avatar-group:size-9 group-has-data-[size=sm]/avatar-group:size-5 group-has-data-[size=xl]/avatar-group:size-12",
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
