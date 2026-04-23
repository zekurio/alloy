import * as React from "react"
import { SearchIcon, XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { AlloyLogoMark } from "@workspace/ui/components/alloy-logo"
import { Kbd } from "@workspace/ui/components/kbd"

function AppHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="app-header"
      className={cn(
        "relative grid min-w-0 items-center gap-2 px-4 sm:gap-3 sm:px-5",
        "[grid-template-columns:auto_minmax(9rem,16rem)_auto]",
        "max-sm:[&:has([data-slot=app-header-search]:focus-within)]:[grid-template-columns:0_minmax(0,1fr)_0]",
        "sm:[grid-template-columns:auto_minmax(12rem,22rem)_auto]",
        "lg:[grid-template-columns:auto_minmax(16rem,28rem)_auto]",
        "[&_[data-slot=app-header-brand]]:col-start-1",
        "[&_[data-slot=app-header-search]]:col-start-2",
        "[&_[data-slot=app-header-actions]]:col-start-3",
        "max-sm:[&:has([data-slot=app-header-search]:focus-within)_[data-slot=app-header-brand]]:opacity-0",
        "max-sm:[&:has([data-slot=app-header-search]:focus-within)_[data-slot=app-header-actions]]:opacity-0",
        "max-sm:[&:has([data-slot=app-header-search]:focus-within)_[data-slot=app-header-brand]]:pointer-events-none",
        "max-sm:[&:has([data-slot=app-header-search]:focus-within)_[data-slot=app-header-actions]]:pointer-events-none",
        "h-[var(--header-h)] border-b border-border bg-surface",
        className
      )}
      {...props}
    />
  )
}

function AppHeaderBrand({
  className,
  size = 32,
  children,
  ...props
}: React.ComponentProps<"div"> & { size?: number }) {
  return (
    <div
      data-slot="app-header-brand"
      className={cn(
        "flex min-w-0 items-center gap-2 justify-self-start font-sans text-md font-bold tracking-normal",
        className
      )}
      {...props}
    >
      <AlloyLogoMark size={size} />
      {children}
    </div>
  )
}

interface AppHeaderSearchProps extends Omit<
  React.ComponentProps<"input">,
  "size" | "type" | "children"
> {
  hint?: React.ReactNode
  icon?: React.ReactNode
  containerClassName?: string
  onClear?: () => void
  /** Accessible label for the clear button. Defaults to "Clear search". */
  clearAriaLabel?: string
  children?: React.ReactNode
}

const AppHeaderSearch = React.forwardRef<
  HTMLInputElement,
  AppHeaderSearchProps
>(function AppHeaderSearch(
  {
    className,
    containerClassName,
    hint = "⌘K",
    icon,
    placeholder = "Search clips and games...",
    onClear,
    clearAriaLabel = "Clear search",
    value,
    children,
    ...props
  },
  ref
) {
  const hasValue =
    onClear != null && typeof value === "string" && value.length > 0

  return (
    <div
      data-slot="app-header-search"
      className={cn(
        "relative w-full min-w-0 justify-self-center",
        "max-sm:focus-within:z-30 max-sm:focus-within:justify-self-stretch",
        containerClassName
      )}
    >
      <div className="group/search relative flex h-[30px] w-full items-center">
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 left-2.5 z-10 -translate-y-1/2",
            // Leading icon picks up the accent colour while the input is
            // focused — another visual cue the field is active.
            "text-foreground-faint [&_svg]:size-3.5",
            "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "group-focus-within/search:text-accent"
          )}
        >
          {icon ?? <SearchIcon />}
        </span>
        <input
          ref={ref}
          data-slot="app-header-search-input"
          placeholder={placeholder}
          value={value}
          className={cn(
            "h-full w-full min-w-0 rounded-md border border-border bg-input pr-11 pl-8",
            "text-sm text-foreground placeholder:text-foreground-faint",
            "transition-[border-color,background-color,box-shadow,border-radius] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "outline-none",
            "focus:border-accent focus:bg-surface-raised",
            "focus:shadow-[0_0_0_3px_var(--accent-soft)]",
            className
          )}
          {...props}
        />
        {hasValue ? (
          <button
            type="button"
            aria-label={clearAriaLabel}
            onClick={onClear}
            className={cn(
              "absolute top-1/2 right-1.5 -translate-y-1/2",
              "grid size-[22px] place-items-center rounded-sm",
              // Brand-blue-aware hover: soft fill from the accent family
              // instead of the off-white the native browser X paints.
              "text-foreground-faint",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:bg-accent-soft hover:text-accent",
              "focus-visible:bg-accent-soft focus-visible:text-accent",
              "focus-visible:ring-2 focus-visible:ring-accent-border focus-visible:outline-none",
              "[&_svg]:size-3"
            )}
          >
            <XIcon />
          </button>
        ) : hint ? (
          <Kbd className="absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline-flex">
            {hint}
          </Kbd>
        ) : null}
      </div>
      {children}
    </div>
  )
})

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
      className={cn("flex items-center gap-1 justify-self-end", className)}
      {...props}
    />
  )
}

export { AppHeader, AppHeaderBrand, AppHeaderSearch, AppHeaderActions }
