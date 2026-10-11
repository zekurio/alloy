import { cn } from "@alloy/ui/lib/utils"
import { ChevronRightIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

const listRowClassName = "flex min-h-14 items-center gap-3 px-3.5 py-2.5"

/**
 * Bordered block of rows separated by hairlines: the shape a managed
 * collection (webhooks, providers, passkeys) or a menu of destinations takes.
 * Pair with {@link ListItem} or {@link ListItemButton}.
 */
function List({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="list"
      className={cn(
        // shrink-0: clipping its corners would otherwise let a full flex
        // column squash the block instead of scrolling.
        "divide-border border-border bg-surface-raised/40 flex shrink-0 flex-col divide-y overflow-hidden rounded-lg border",
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
function ListItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="list-item"
      className={cn(listRowClassName, className)}
      {...props}
    />
  )
}

/**
 * A {@link List} row that is one tap target. By default it opens something (a
 * page, or the editor for the item it names) and the trailing chevron says so,
 * which is why such a row holds no controls of its own. A row that acts in
 * place instead passes the glyph for that action as `trailing`.
 */
function ListItemButton({
  className,
  children,
  trailing,
  ...props
}: ComponentProps<"button"> & { trailing?: ReactNode }) {
  return (
    <li data-slot="list-item">
      <button
        type="button"
        className={cn(
          listRowClassName,
          "w-full text-left transition-colors",
          "hover:bg-surface-raised/60 focus-visible:bg-surface-raised/60",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
          "disabled:pointer-events-none disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
        {trailing ?? (
          <ChevronRightIcon
            aria-hidden
            className="text-foreground-faint size-4 shrink-0"
          />
        )}
      </button>
    </li>
  )
}

export { List, ListItem, ListItemButton }
