import * as React from "react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"

interface UserAvatarButtonProps extends React.ComponentProps<"button"> {
  avatar: {
    initials: string
    bg?: string
    fg?: string
    src?: string
  }
  /** Accessible label describing whose avatar this is — fed to aria-label. */
  name: string
}

function UserAvatarButton({
  className,
  avatar,
  name,
  children,
  "aria-label": ariaLabel,
  ...props
}: UserAvatarButtonProps) {
  const tintStyle = {
    background: avatar.bg ?? "var(--neutral-200)",
    color: avatar.fg ?? "var(--foreground)",
  }
  return (
    <button
      type="button"
      data-slot="user-avatar-button"
      aria-label={ariaLabel ?? name}
      className={cn(
        "group inline-flex shrink-0 rounded-lg",
        "transition-shadow duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:ring-2 hover:ring-border-strong",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
        "data-popup-open:ring-2 data-popup-open:ring-accent",
        className
      )}
      {...props}
    >
      <Avatar size="lg" className="rounded-lg" style={tintStyle}>
        {avatar.src ? <AvatarImage src={avatar.src} alt="" /> : null}
        <AvatarFallback style={tintStyle}>{avatar.initials}</AvatarFallback>
      </Avatar>
      {children}
    </button>
  )
}

export { UserAvatarButton, type UserAvatarButtonProps }
