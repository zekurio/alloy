import { useImageLoaded } from "@alloy/ui/hooks/use-image-loaded"
import { cn } from "@alloy/ui/lib/utils"
import { Avatar } from "@base-ui/react/avatar"
import { Children, isValidElement } from "react"
import type { ComponentProps, ReactNode } from "react"

const avatarRootSizeClasses = [
  "data-[size=sm]:size-5 data-[size=sm]:text-[8px]",
  "data-[size=md]:size-7 data-[size=md]:text-[11px]",
  "data-[size=nav]:size-8 data-[size=nav]:text-xs",
  "data-[size=lg]:size-9 data-[size=lg]:text-[14px]",
  "data-[size=xl]:size-12 data-[size=xl]:text-[18px]",
  "data-[size=2xl]:size-24 data-[size=2xl]:text-[28px]",
]

const avatarBadgeSizeClasses = [
  "group-data-[size=sm]/avatar:size-2",
  "group-data-[size=md]/avatar:size-2.5",
  "group-data-[size=lg]/avatar:size-3",
  "group-data-[size=xl]/avatar:size-3.5",
  "group-data-[size=2xl]/avatar:size-5",
]

function getAvatarImageKey(children: ReactNode): string {
  return Children.toArray(children).reduce<string>((imageKey, child) => {
    if (!isValidElement<{ children?: ReactNode; src?: unknown }>(child)) {
      return imageKey
    }

    if (child.type === AvatarImage) {
      return typeof child.props.src === "string" && child.props.src
        ? child.props.src
        : "fallback"
    }

    if (child.props.children === undefined) return imageKey

    const nestedKey = getAvatarImageKey(child.props.children)
    return nestedKey !== "fallback" ? nestedKey : imageKey
  }, "fallback")
}

function AvatarRoot({
  className,
  size = "md",
  ring = false,
  children,
  ...props
}: Avatar.Root.Props & {
  size?: "sm" | "md" | "nav" | "lg" | "xl" | "2xl"
  ring?: boolean
}) {
  const imageKey = getAvatarImageKey(children)

  return (
    <Avatar.Root
      key={imageKey}
      data-slot="avatar"
      data-size={size}
      data-ring={ring || undefined}
      className={cn(
        "group/avatar relative inline-flex shrink-0 overflow-hidden select-none",
        "items-center justify-center rounded-full bg-neutral-200 font-semibold text-foreground",
        "leading-none",
        ...avatarRootSizeClasses,
        "data-[ring=true]:shadow-[0_0_0_1.5px_var(--background),0_0_0_3px_var(--accent)]",
        className,
      )}
      {...props}
    >
      {children}
    </Avatar.Root>
  )
}

function AvatarImage({
  className,
  src,
  onLoadingStatusChange,
  ...props
}: Avatar.Image.Props) {
  const image = useImageLoaded(src)
  const showLoadingMask =
    !!src && image.status !== "loaded" && image.status !== "error"

  return (
    <>
      <Avatar.Image
        data-slot="avatar-image"
        src={src}
        onLoadingStatusChange={(nextStatus) => {
          image.setStatus(nextStatus)
          onLoadingStatusChange?.(nextStatus)
        }}
        className={cn("size-full object-cover", className)}
        {...props}
      />
      {showLoadingMask ? (
        <span
          aria-hidden
          data-slot="avatar-image-loading"
          className="bg-muted absolute inset-0 z-10"
        />
      ) : null}
    </>
  )
}

function AvatarFallback({ className, ...props }: Avatar.Fallback.Props) {
  return (
    <Avatar.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "grid size-full place-items-center text-center leading-none",
        className,
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none",
        ...avatarBadgeSizeClasses,
        className,
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className,
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground-muted ring-2 ring-background select-none",
        "size-7 text-[10px] leading-3 group-has-data-[size=lg]/avatar-group:size-9 group-has-data-[size=sm]/avatar-group:size-5 group-has-data-[size=xl]/avatar-group:size-12",
        className,
      )}
      {...props}
    />
  )
}

export {
  AvatarRoot as Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
}
