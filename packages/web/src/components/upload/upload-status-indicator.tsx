import { t as tx } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import { ChevronDownIcon, CloudUploadIcon, Loader2Icon } from "lucide-react"
import * as React from "react"

/**
 * Floating button that opens current upload and clip download activity.
 * It never starts a transfer; transfers originate in the queue modal, desktop
 * library, or editor publish flow.
 */
export function UploadStatusIndicator({
  activeCount,
  isOpen,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  activeCount: number
  /** Driven by the popover state - flips the icon and scales the FAB. */
  isOpen: boolean
}) {
  return (
    <button
      type="button"
      aria-label={
        activeCount > 0
          ? tx("View transfer activity - {count} in progress", {
              count: activeCount,
            })
          : tx("View transfer activity")
      }
      {...props}
      aria-hidden={isOpen || undefined}
      tabIndex={isOpen ? -1 : undefined}
      style={{ transformOrigin: "bottom right" }}
      className={cn(
        "group/fab fixed right-5 bottom-[calc(env(safe-area-inset-bottom,0px)+5.25rem)] z-40 md:right-8 md:bottom-[6.25rem]",
        "flex size-12 items-center justify-center rounded-full",
        "border border-accent bg-accent text-accent-foreground",
        "shadow-lg shadow-black/40",
        "transition-[background-color,box-shadow,transform,opacity]",
        "duration-[280ms] ease-[var(--ease-out)]",
        "hover:bg-accent-hover hover:shadow-xl",
        "active:bg-accent-active",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        isOpen
          ? "pointer-events-none scale-0 rotate-[-12deg] opacity-0 duration-[160ms] ease-[var(--ease-out)]"
          : "scale-100 rotate-0 opacity-100",
        className,
      )}
    >
      <span className="relative inline-flex size-5 items-center justify-center">
        {activeCount > 0 ? (
          <Loader2Icon
            aria-hidden
            className={cn(
              "absolute size-5 transition-[transform,opacity] duration-[var(--duration-base)] ease-[var(--ease-out)]",
              !isOpen && "animate-spin",
              isOpen
                ? "scale-50 rotate-90 opacity-0"
                : "scale-100 rotate-0 opacity-100",
            )}
          />
        ) : (
          <CloudUploadIcon
            aria-hidden
            className={cn(
              "absolute size-5 transition-[transform,opacity] duration-[var(--duration-base)] ease-[var(--ease-out)]",
              isOpen
                ? "scale-50 rotate-90 opacity-0"
                : "scale-100 rotate-0 opacity-100",
            )}
          />
        )}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "absolute size-5 transition-[transform,opacity] duration-[var(--duration-base)] ease-[var(--ease-out)]",
            isOpen
              ? "scale-100 rotate-0 opacity-100"
              : "scale-50 -rotate-90 opacity-0",
          )}
        />
      </span>
      {activeCount > 0 ? (
        <span
          aria-hidden
          className={cn(
            "absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center px-1",
            "rounded-full border-2 border-background bg-surface-raised",
            "text-xs font-semibold text-foreground tabular-nums",
            "transition-[transform,opacity] duration-[var(--duration-base)] ease-[var(--ease-out)]",
            isOpen && "scale-75 opacity-0",
          )}
        >
          {activeCount}
        </span>
      ) : null}
      {children}
    </button>
  )
}
