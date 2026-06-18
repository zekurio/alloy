import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { Kbd } from "@alloy/ui/components/kbd"
import { cn } from "@alloy/ui/lib/utils"
import { Maximize2Icon, MinusIcon, SearchIcon, XIcon } from "lucide-react"
import * as React from "react"

function AppHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="app-header"
      className={cn(
        "relative grid min-w-0 items-center gap-2 px-4 sm:gap-3 sm:px-5",
        "[grid-template-columns:auto_minmax(0,1fr)_auto_auto]",
        "[&_[data-slot=app-header-brand]]:col-start-1",
        "[&_[data-slot=app-header-search]]:col-start-2",
        "[&_[data-slot=app-header-actions]]:col-start-3",
        "[&_[data-slot=app-header-window-controls]]:col-start-4",
        "max-sm:[&:has([data-slot=app-header-search]:focus-within)_[data-slot=app-header-brand]]:pointer-events-none",
        "max-sm:[&:has([data-slot=app-header-search]:focus-within)_[data-slot=app-header-brand]]:opacity-0",
        "max-sm:[&:has([data-slot=app-header-search]:focus-within)_[data-slot=app-header-actions]]:pointer-events-none",
        "max-sm:[&:has([data-slot=app-header-search]:focus-within)_[data-slot=app-header-actions]]:opacity-0",
        "h-[var(--header-h)] border-b border-border bg-surface",
        className,
      )}
      {...props}
    />
  )
}

function AppHeaderBrand({
  className,
  size = 32,
  showText = false,
  children,
  ...props
}: React.ComponentProps<"div"> & { size?: number; showText?: boolean }) {
  return (
    <div
      data-slot="app-header-brand"
      className={cn(
        "flex min-w-0 items-center gap-2 justify-self-start font-sans text-md font-bold tracking-normal",
        className,
      )}
      {...props}
    >
      <AlloyLogo size={size} showText={showText} spacing={8} />
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
    hint,
    icon,
    placeholder = "Search clips and games...",
    onClear,
    clearAriaLabel = "Clear search",
    value,
    children,
    ...props
  },
  ref,
) {
  const resolvedHint = hint ?? <DefaultSearchHint />
  const hasValue =
    onClear != null && typeof value === "string" && value.length > 0

  return (
    <div
      data-slot="app-header-search"
      className={cn(
        "relative w-full max-w-[28rem] min-w-0 justify-self-center",
        "max-sm:focus-within:z-30",
        containerClassName,
      )}
    >
      <div className="group/search relative flex h-9 w-full items-center sm:h-8">
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 left-2.5 z-10 -translate-y-1/2",
            // Leading icon picks up the accent colour while the input is
            // focused — another visual cue the field is active.
            "text-foreground-faint [&_svg]:size-3.5",
            "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "group-focus-within/search:text-accent",
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
            "h-full w-full min-w-0 rounded-lg border border-border bg-input pr-11 pl-8",
            "text-sm text-foreground placeholder:text-foreground-faint",
            "transition-[border-color,background-color,box-shadow,border-radius] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "outline-none",
            "focus:border-accent focus:bg-surface-raised",
            "focus:shadow-[0_0_0_3px_var(--accent-soft)]",
            className,
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
              "grid size-6 place-items-center rounded-sm",
              // Brand-blue-aware hover: soft fill from the accent family
              // instead of the off-white the native browser X paints.
              "text-foreground-faint",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:bg-accent-soft hover:text-accent",
              "focus-visible:bg-accent-soft focus-visible:text-accent",
              "focus-visible:ring-2 focus-visible:ring-accent-border focus-visible:outline-none",
              "[&_svg]:size-3",
            )}
          >
            <XIcon />
          </button>
        ) : resolvedHint ? (
          <Kbd className="absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline-flex">
            {resolvedHint}
          </Kbd>
        ) : null}
      </div>
      {children}
    </div>
  )
})

function useIsMacPlatform() {
  const [isMac, setIsMac] = React.useState(false)
  React.useEffect(() => {
    if (typeof navigator === "undefined") return
    const platform =
      // `userAgentData.platform` is the modern API; fall back to the legacy
      // `navigator.platform` string for browsers that don't expose it yet.
      (
        navigator as Navigator & {
          userAgentData?: { platform?: string }
        }
      ).userAgentData?.platform ??
      navigator.platform ??
      ""
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform))
  }, [])
  return isMac
}

function DefaultSearchHint() {
  const isMac = useIsMacPlatform()
  return isMac ? <>⌘K</> : <>Ctrl K</>
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
      className={cn("flex items-center gap-1 justify-self-end", className)}
      {...props}
    />
  )
}

interface AppHeaderWindowControlsProps extends Omit<
  React.ComponentProps<"div">,
  "children"
> {
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

function AppHeaderWindowControls({
  className,
  onMinimize,
  onToggleMaximize,
  onClose,
  ...props
}: AppHeaderWindowControlsProps) {
  return (
    <div
      data-slot="app-header-window-controls"
      className={cn("flex h-full items-stretch justify-self-end", className)}
      {...props}
    >
      <WindowControlButton aria-label="Minimize" onClick={onMinimize}>
        <MinusIcon />
      </WindowControlButton>
      <WindowControlButton
        aria-label="Maximize or restore"
        onClick={onToggleMaximize}
      >
        <Maximize2Icon />
      </WindowControlButton>
      <WindowControlButton aria-label="Close" danger onClick={onClose}>
        <XIcon />
      </WindowControlButton>
    </div>
  )
}

function WindowControlButton({
  className,
  danger,
  ...props
}: React.ComponentProps<"button"> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "grid h-full w-12 place-items-center text-foreground-muted",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-surface-raised hover:text-foreground",
        "focus-visible:bg-surface-raised focus-visible:text-foreground",
        "focus-visible:ring-0 focus-visible:outline-none",
        "[&_svg]:size-4",
        danger &&
          "hover:bg-danger hover:text-white focus-visible:bg-danger focus-visible:text-white",
        className,
      )}
      {...props}
    />
  )
}

export {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
  AppHeaderSearch,
  AppHeaderWindowControls,
}
