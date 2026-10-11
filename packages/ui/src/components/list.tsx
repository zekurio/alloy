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
 * page, or the editor for the item it names) and the trailing chevron says so.
 * A row that acts in place instead passes the glyph for that action as
 * `trailing`.
 *
 * `actions` are controls that change the item without opening it, such as a
 * switch or a delete button. They sit before the chevron, and the rest of the
 * row, chevron included, stays the tap target.
 */
function ListItemButton({
  className,
  children,
  trailing,
  actions,
  ...props
}: ComponentProps<"button"> & { trailing?: ReactNode; actions?: ReactNode }) {
  const glyph = trailing ?? (
    <ChevronRightIcon
      aria-hidden
      className="text-foreground-faint size-4 shrink-0"
    />
  )
  return (
    <li
      data-slot="list-item"
      className={cn(
        "relative flex items-stretch transition-colors",
        // Lit by its own tap target only, so pointing at a control in
        // `actions` does not read as pointing at the row.
        "has-[>button:hover]:bg-surface-raised/60 has-[>button:focus-visible]:bg-surface-raised/60",
      )}
    >
      <button
        type="button"
        className={cn(
          listRowClassName,
          "min-w-0 flex-1 cursor-pointer text-left outline-none",
          // The target is stretched over the whole row, under `actions`, so
          // the focus ring frames the row rather than the label.
          "after:absolute after:inset-0",
          "focus-visible:after:ring-ring focus-visible:after:ring-2 focus-visible:after:ring-inset",
          "disabled:pointer-events-none disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
        {actions ? null : glyph}
      </button>
      {actions ? (
        <>
          {/* Full row height: a tap that just misses a control lands here
              and does nothing, instead of opening the item. An icon button's
              glyph sits inset from its box, so a trailing one needs no gap
              before the chevron. */}
          <div className="relative flex shrink-0 items-center gap-1 pr-2 has-[>button:last-child]:pr-0">
            {actions}
          </div>
          {/* Left unpositioned so the stretched target covers it too. */}
          <span className="flex shrink-0 items-center pr-3.5">{glyph}</span>
        </>
      ) : null}
    </li>
  )
}

export { List, ListItem, ListItemButton }
