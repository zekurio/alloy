import { Chip } from "@alloy/ui/components/chip"
import { cn } from "@alloy/ui/lib/utils"
import { ChevronDownIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

/** Uppercase label rendered before a toolbar trigger (e.g. "Sort", "Game"). */
export const filterLabelClass =
  "inline-flex h-7 items-center pr-0.5 text-2xs leading-3 font-semibold tracking-wide text-foreground-faint uppercase"

/**
 * Compact chip trigger showing the active option's icon + label and a trailing
 * chevron. Shared by the sort and filter dropdowns' `chip` variant.
 */
export function ToolbarChipTrigger({
  icon,
  label,
  className,
  ...props
}: ComponentProps<typeof Chip> & {
  icon?: ReactNode
  label?: ReactNode
}) {
  return (
    <Chip
      size="xl"
      className={cn(
        "h-7 w-auto max-w-[9.5rem] min-w-0 justify-start gap-1.5 rounded-md border-transparent bg-transparent px-2 text-xs leading-3 font-medium text-foreground-muted hover:border-border hover:bg-surface-raised/60 hover:text-foreground",
        "[&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <ChevronDownIcon />
    </Chip>
  )
}
