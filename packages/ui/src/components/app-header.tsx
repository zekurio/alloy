import * as React from "react"
import { SearchIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { AlloyLogoMark } from "@workspace/ui/components/alloy-logo"
import { Kbd } from "@workspace/ui/components/kbd"

/**
 * Alloy AppHeader — the 52px top bar that pairs with `AppShell`.
 *
 * Compose with the slot components:
 *   <AppHeader>
 *     <AppHeaderBrand>Alloy</AppHeaderBrand>
 *     <AppHeaderSearch placeholder="Search clips…" />
 *     <AppHeaderActions>
 *       <Button size="sm">Record</Button>
 *       <UserChip … />
 *     </AppHeaderActions>
 *   </AppHeader>
 */
function AppHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="app-header"
      className={cn(
        "flex items-center gap-4 px-5",
        "h-[var(--header-h)] border-b border-border bg-surface",
        className
      )}
      {...props}
    />
  )
}

/**
 * Brand slot — AlloyLogoMark + a mono uppercase "Alloy" wordmark.
 * Pass `size` to scale the mark (default 22px). `children` overrides the
 * wordmark if you need a different label.
 */
function AppHeaderBrand({
  className,
  size = 22,
  children = "Alloy",
  ...props
}: React.ComponentProps<"div"> & { size?: number }) {
  return (
    <div
      data-slot="app-header-brand"
      className={cn(
        "flex items-center gap-2 font-mono text-sm font-medium uppercase tracking-[0.12em]",
        className
      )}
      {...props}
    >
      <AlloyLogoMark size={size} />
      {children}
    </div>
  )
}

/**
 * Search bar — the centred input-group with a leading search icon and a
 * trailing ⌘K hint. Accepts any standard input props; spread to the inner
 * `<input>`.
 *
 * The outer container is `max-w-[420px] flex-1 ml-5` to match the handoff.
 */
interface AppHeaderSearchProps
  extends Omit<React.ComponentProps<"input">, "size"> {
  hint?: React.ReactNode
  icon?: React.ReactNode
  containerClassName?: string
}

function AppHeaderSearch({
  className,
  containerClassName,
  hint = "⌘K",
  icon,
  placeholder = "Search clips, games, friends…",
  ...props
}: AppHeaderSearchProps) {
  return (
    <div
      data-slot="app-header-search"
      className={cn("ml-5 max-w-[420px] flex-1", containerClassName)}
    >
      <div className="group/search relative flex h-[30px] w-full items-center">
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2",
            "text-foreground-faint [&_svg]:size-3.5"
          )}
        >
          {icon ?? <SearchIcon />}
        </span>
        <input
          data-slot="app-header-search-input"
          placeholder={placeholder}
          className={cn(
            "h-full w-full rounded-md border border-border bg-input pr-11 pl-8",
            "text-sm text-foreground placeholder:text-foreground-faint",
            "transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "outline-none focus:border-accent-border focus:bg-surface-raised",
            className
          )}
          {...props}
        />
        {hint ? (
          <Kbd className="absolute right-2 top-1/2 -translate-y-1/2">
            {hint}
          </Kbd>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Header actions — right-aligned group for buttons, user chip, etc.
 * Uses `ml-auto` so it pins to the right regardless of the search width.
 */
function AppHeaderActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="app-header-actions"
      className={cn("ml-auto flex items-center gap-1.5", className)}
      {...props}
    />
  )
}

export { AppHeader, AppHeaderBrand, AppHeaderSearch, AppHeaderActions }
