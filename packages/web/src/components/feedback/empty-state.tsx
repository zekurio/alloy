import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { pickEmptyStateKaomoji } from "@/lib/kaomoji"

interface EmptyStateProps extends React.ComponentProps<"div"> {
  seed?: string | number
  title: string
  hint?: React.ReactNode
  /** Optional trailing action node (button, link). */
  action?: React.ReactNode
  size?: "sm" | "md" | "lg"
}

const sizeClasses: Record<NonNullable<EmptyStateProps["size"]>, string> = {
  sm: "py-8",
  md: "py-12",
  lg: "py-20",
}

const faceSizeClasses: Record<NonNullable<EmptyStateProps["size"]>, string> = {
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-5xl",
}

export function EmptyState({
  seed,
  title,
  hint,
  action,
  size = "md",
  className,
  ...props
}: EmptyStateProps) {
  const face = React.useMemo(() => pickEmptyStateKaomoji(seed), [seed])

  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md",
        "text-center",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "font-mono leading-none text-foreground-faint select-none",
          faceSizeClasses[size],
        )}
      >
        {face}
      </span>
      <div className="flex flex-col gap-1 px-6">
        <p className="text-foreground text-sm font-medium">{title}</p>
        {hint ? <p className="text-foreground-dim text-sm">{hint}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
