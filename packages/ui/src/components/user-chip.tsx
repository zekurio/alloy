import * as React from "react"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * User chip — the compact identity pill used in the app header
 * (avatar · name · chevron). 30px tall, border that lifts on hover.
 *
 * `avatar` lets callers control the avatar's background / foreground via
 * inline style so different users can be tinted differently without needing
 * an image.
 */
interface UserChipProps extends React.ComponentProps<"button"> {
  name: string
  avatar: {
    initials: string
    bg?: string
    fg?: string
    src?: string
  }
}

function UserChip({
  className,
  name,
  avatar,
  children,
  ...props
}: UserChipProps) {
  return (
    <button
      type="button"
      data-slot="user-chip"
      className={cn(
        "group inline-flex h-[30px] items-center gap-2 py-[3px] pr-3 pl-[3px]",
        "rounded-md border border-border bg-surface-raised text-foreground",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:border-border-strong",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className
      )}
      {...props}
    >
      <span
        className="inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[3px] text-[10px] font-semibold"
        style={{
          background: avatar.bg ?? "var(--neutral-200)",
          color: avatar.fg ?? "var(--foreground)",
        }}
      >
        {avatar.src ? (
          <img
            src={avatar.src}
            alt={avatar.initials}
            className="size-full object-cover"
          />
        ) : (
          avatar.initials
        )}
      </span>
      <span className="text-xs font-semibold leading-none">{name}</span>
      {children ?? (
        <ChevronRightIcon className="ml-1 size-3 rotate-90 text-foreground-faint" />
      )}
    </button>
  )
}

export { UserChip, type UserChipProps }
