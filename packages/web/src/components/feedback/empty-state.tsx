import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@alloy/ui/components/empty"
import { cn } from "@alloy/ui/lib/utils"
import { useMemo } from "react"
import type { ComponentProps, ReactNode } from "react"

import { pickEmptyStateKaomoji } from "@/lib/kaomoji"

interface EmptyStateProps extends ComponentProps<typeof Empty> {
  seed?: string | number
  title: string
  hint?: ReactNode
  /** Optional trailing action node (button, link). */
  action?: ReactNode
  size?: "sm" | "md" | "lg"
  /** Fill a page-level area (min height) instead of hugging its content. */
  fill?: boolean
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
  fill = false,
  className,
  ...props
}: EmptyStateProps) {
  const face = useMemo(() => pickEmptyStateKaomoji(seed), [seed])

  return (
    <Empty
      className={cn(sizeClasses[size], fill && "min-h-[22rem]", className)}
      {...props}
    >
      <EmptyHeader>
        <EmptyMedia>
          <span
            aria-hidden
            className={cn(
              "font-mono leading-none text-foreground-faint select-none",
              faceSizeClasses[size],
            )}
          >
            {face}
          </span>
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {hint ? <EmptyDescription>{hint}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
