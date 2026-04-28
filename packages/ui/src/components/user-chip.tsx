import * as React from "react"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

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
        "group inline-flex h-8 items-center gap-2 py-0.5 pr-3 pl-0.5",
        "rounded-md border border-border bg-surface-raised text-foreground",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:border-border-strong",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
        className
      )}
      {...props}
    >
      <span
        className="relative inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[4px] text-[10px] leading-3 font-semibold"
        style={{
          background: avatar.bg ?? "var(--neutral-200)",
          color: avatar.fg ?? "var(--foreground)",
        }}
      >
        <span aria-hidden>{avatar.initials}</span>
        {avatar.src ? (
          <UserChipImage key={avatar.src} src={avatar.src} />
        ) : null}
      </span>
      <span className="text-xs leading-4 font-semibold">{name}</span>
      {children ?? (
        <ChevronRightIcon className="ml-1 size-3 rotate-90 text-foreground-faint" />
      )}
    </button>
  )
}

function UserChipImage({ src }: { src: string }) {
  const [loaded, setLoaded] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  if (failed) return null

  return (
    <img
      src={src}
      alt=""
      className={cn(
        "absolute inset-0 size-full object-cover",
        loaded ? "opacity-100" : "opacity-0"
      )}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  )
}

export { UserChip, type UserChipProps }
