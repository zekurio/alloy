import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

/**
 * Vertical list with a solid rail down the left edge, signalling that the rows
 * below read together as a single list. Pair with {@link ListItem}.
 */
function List({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="list"
      className={cn(
        "relative flex flex-col pl-4",
        "before:pointer-events-none before:absolute before:inset-y-0 before:left-px before:w-px before:bg-border-emphasis before:content-['']",
        className,
      )}
      {...props}
    />
  )
}

/**
 * A single row in a {@link List}. Lay out a `min-w-0 flex-1` primary block
 * followed by `shrink-0` trailing controls and they space apart automatically.
 */
function ListItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="list-item"
      className={cn(
        "flex items-center gap-3 py-2 first:pt-0 last:pb-0",
        className,
      )}
      {...props}
    />
  )
}

export { List, ListItem }
