import * as React from "react"
import { SearchIcon, XIcon } from "lucide-react"

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
        "grid min-w-0 items-center gap-4 px-5",
        "[grid-template-columns:minmax(0,1fr)_minmax(12rem,26rem)_minmax(0,1fr)]",
        "sm:[grid-template-columns:minmax(0,1fr)_minmax(16rem,28rem)_minmax(0,1fr)]",
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
        "flex min-w-0 items-center gap-2 justify-self-start font-mono text-sm font-medium tracking-[0.12em] uppercase",
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
 * When the caller wires `onClear` + a non-empty `value`, the ⌘K hint is
 * replaced by a custom clear button (brand-blue accent on hover). We
 * deliberately don't use `type="search"` — that would layer a browser-
 * provided X on top that ignores our colour tokens. Focus state doubles
 * up on the cue: bg lift + stronger border + a soft brand-blue ring so
 * the input reads as clearly active at a glance.
 */
interface AppHeaderSearchProps extends Omit<
  React.ComponentProps<"input">,
  "size" | "type" | "children"
> {
  hint?: React.ReactNode
  icon?: React.ReactNode
  containerClassName?: string
  /**
   * Optional handler for the inline clear button. When provided and
   * `value` is non-empty, replaces the ⌘K hint with an X button styled
   * in the brand-blue accent family. Omit to opt out — the hint stays
   * and no clear affordance renders.
   */
  onClear?: () => void
  /** Accessible label for the clear button. Defaults to "Clear search". */
  clearAriaLabel?: string
  /**
   * Overlay slot rendered as a sibling of the input inside the search
   * wrapper — intended for a results popover anchored under the input.
   * The wrapper is position:relative, so children can `absolute
   * top-full left-0 right-0` themselves without extra plumbing. Kept
   * as a prop rather than a ref-forwarded anchor so the header layout
   * (grid column + justify-self) stays in one place.
   */
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
  // A clear button only makes sense when the input has text + the caller
  // opted in. `value` is a controlled-input contract here; uncontrolled
  // callers (no `value` prop) keep the ⌘K hint regardless.
  const hasValue =
    onClear != null && typeof value === "string" && value.length > 0

  return (
    <div
      data-slot="app-header-search"
      className={cn(
        "relative w-full min-w-0 justify-self-center",
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
            "transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "outline-none",
            // Stronger focus signalling: full accent border (not the soft
            // 0.42-alpha variant), a lifted background, and a tinted glow
            // ring so the input clearly reads as active even with the
            // dense header chrome around it.
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
      className={cn("flex items-center gap-1.5 justify-self-end", className)}
      {...props}
    />
  )
}

export { AppHeader, AppHeaderBrand, AppHeaderSearch, AppHeaderActions }
