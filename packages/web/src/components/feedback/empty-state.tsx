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
  /** Lucide icon for the media slot. */
  icon?: ComponentType<{ className?: string }>
}

interface ContentEmptyStateProps extends Omit<EmptyStateProps, "icon"> {
  /** Stable face selection for the kaomoji. */
  seed?: string | number
}

const sizeClasses = {
  sm: "py-8",
  md: "py-12",
  lg: "py-20",
} satisfies Record<NonNullable<EmptyStateProps["size"]>, string>

const faceSizeClasses = {
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-5xl",
} satisfies Record<NonNullable<EmptyStateProps["size"]>, string>

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

/** Functional empty and error states use a consistent icon treatment. */
export function EmptyState({
  icon: Icon = CircleDashedIcon,
  ...props
}: EmptyStateProps) {
  return (
    <EmptyStateLayout
      media={
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
      }
      {...props}
    />
  )
}

/** Spacious social and clip surfaces use a lightweight kaomoji treatment. */
export function ContentEmptyState({
  seed,
  size = "md",
  ...props
}: ContentEmptyStateProps) {
  const face = useMemo(() => pickEmptyStateKaomoji(seed), [seed])
  return (
    <EmptyStateLayout
      size={size}
      media={
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
      }
      {...props}
    />
  )
}

function EmptyStateLayout({
  title,
  hint,
  action,
  size = "md",
  fill = false,
  media,
  className,
  ...props
}: Omit<EmptyStateProps, "icon"> & { media: ReactNode }) {
  return (
    <Empty
      className={cn(sizeClasses[size], fill && "min-h-[22rem]", className)}
      {...props}
    >
      <EmptyHeader>
        {media}
        <EmptyTitle>{title}</EmptyTitle>
        {hint ? <EmptyDescription>{hint}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
