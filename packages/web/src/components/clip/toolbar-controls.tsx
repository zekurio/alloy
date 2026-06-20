import { Button } from "@alloy/ui/components/button"
import { Chip } from "@alloy/ui/components/chip"
import { cn } from "@alloy/ui/lib/utils"
import { ChevronDownIcon } from "lucide-react"
import type * as React from "react"

/** Uppercase label rendered before a toolbar trigger (e.g. "Sort", "Game"). */
export const filterLabelClass =
  "inline-flex h-7 items-center pr-0.5 text-2xs leading-3 font-semibold tracking-wide text-foreground-faint uppercase"

/**
 * Shared styling for the square icon-only trigger used by the header toolbar
 * dropdowns. The closed state stays quiet and transparent, with only a soft
 * surface on hover so header controls do not compete with the search field.
 */
export const toolbarIconButtonClass =
  "h-7 min-w-7 rounded-md border-transparent bg-transparent px-1.5 text-foreground-muted shadow-none hover:border-border hover:bg-surface-raised/60 hover:text-foreground max-md:size-10 max-md:min-w-10 max-md:px-0 max-md:hover:border-transparent max-md:hover:bg-transparent [&_svg:not([class*='size-'])]:size-3.5"

/**
 * Icon-only toolbar trigger. Defaults to the secondary/sm look shared by the
 * sort and filter dropdowns; pass `size`/`className` to tweak per call site.
 */
export function ToolbarIconButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className={cn(toolbarIconButtonClass, className)}
      {...props}
    />
  )
}

/**
 * Compact chip trigger showing the active option's icon + label and a trailing
 * chevron. Shared by the sort and filter dropdowns' `chip` variant.
 */
export function ToolbarChipTrigger({
  icon,
  label,
  className,
  ...props
}: React.ComponentProps<typeof Chip> & {
  icon?: React.ReactNode
  label?: React.ReactNode
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
