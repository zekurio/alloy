import { cn } from "@workspace/ui/lib/utils"

/**
 * Alloy Kbd — monospaced key cap with a thicker bottom border to suggest
 * depth without a real shadow. Matches `.kbd` in components.css.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center px-1",
        "rounded-md border border-b-2 border-border bg-surface-raised",
        "font-mono text-2xs leading-3 font-medium text-foreground-muted select-none",
        "[&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
