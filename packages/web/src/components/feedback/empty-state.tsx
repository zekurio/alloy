import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@alloy/ui/components/empty"
import { cn } from "@alloy/ui/lib/utils"
import { CircleDashedIcon } from "lucide-react"
import { useMemo } from "react"
import type { ComponentProps, ComponentType, ReactNode } from "react"

import { pickEmptyStateKaomoji } from "@/lib/kaomoji"

interface EmptyStateProps extends ComponentProps<typeof Empty> {
  title: string
  hint?: ReactNode
  /** Optional trailing action node (button, link). */
  action?: ReactNode
  size?: "sm" | "md" | "lg"
  /** Fill a page-level area (min height) instead of hugging its content. */
  fill?: boolean
  /** Lucide icon for the media slot. Ignored when `kaomoji` is set. */
  icon?: ComponentType<{ className?: string }>
  /**
   * Render a kaomoji face instead of an icon. Reserved for social/user-content
   * empties (comments, profile clips, library) — functional and error states
   * use icons.
   */
  kaomoji?: boolean
  /** Stable face selection for the kaomoji variant. */
  seed?: string | number
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

/**
 * Compact placeholder for empty inline lists (settings cards, admin panels)
 * where the full {@link EmptyState} would be too loud.
 */
export function ListEmpty({
  title,
  className,
}: {
  title: string
  className?: string
}) {
  return (
    <p
      className={cn(
        "text-foreground-muted py-6 text-center text-sm",
        className,
      )}
    >
      {title}
    </p>
  )
}

function KaomojiFace({
  seed,
  size,
}: {
  seed: EmptyStateProps["seed"]
  size: NonNullable<EmptyStateProps["size"]>
}) {
  const face = useMemo(() => pickEmptyStateKaomoji(seed), [seed])
  return (
    <span
      aria-hidden
      className={cn(
        "font-mono leading-none text-foreground-faint select-none",
        faceSizeClasses[size],
      )}
    >
      {face}
    </span>
  )
}

export function EmptyState({
  title,
  hint,
  action,
  size = "md",
  fill = false,
  icon: Icon = CircleDashedIcon,
  kaomoji = false,
  seed,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <Empty
      className={cn(sizeClasses[size], fill && "min-h-[22rem]", className)}
      {...props}
    >
      <EmptyHeader>
        {kaomoji ? (
          <EmptyMedia>
            <KaomojiFace seed={seed} size={size} />
          </EmptyMedia>
        ) : (
          <EmptyMedia variant="icon" size={size}>
            <Icon aria-hidden />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {hint ? <EmptyDescription>{hint}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
