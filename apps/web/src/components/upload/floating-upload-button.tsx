import * as React from "react"
import { ChevronDownIcon, UploadIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export function FloatingUploadButton({
  activeCount,
  isOpen,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  activeCount: number
  /** Driven by the popover state — flips the icon + subtly scales the FAB. */
  isOpen: boolean
}) {
  return (
    <button
      type="button"
      aria-label={
        activeCount > 0
          ? `Open uploads — ${activeCount} in progress`
          : "Open uploads"
      }
      {...props}
      aria-hidden={isOpen || undefined}
      tabIndex={isOpen ? -1 : undefined}
      style={{ transformOrigin: "bottom right" }}
      className={cn(
        "group/fab fixed right-6 bottom-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+0.75rem)] z-40 md:bottom-6",
        "flex size-12 items-center justify-center rounded-full",
        "bg-accent text-accent-foreground",
        "border border-accent",
        "shadow-lg shadow-black/40",
        // Spring-ish easing on scale/rotate so the FAB pops back in
        // with a little overshoot that mirrors the popover's morph.
        "transition-[background-color,box-shadow,transform,opacity]",
        "duration-[280ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
        "hover:bg-accent-hover hover:shadow-xl",
        "active:bg-accent-active",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        isOpen
          ? "pointer-events-none scale-0 rotate-[-12deg] opacity-0 duration-[160ms] ease-[cubic-bezier(0.36,0,0.66,-0.2)]"
          : "scale-100 rotate-0 opacity-100",
        className
      )}
    >
      {/*
       * Cross-rotate morph: UploadIcon rotates out + fades as
       * ChevronDownIcon rotates in. Both icons share the same 5×5 slot
       * (absolute + inset-0) so the button geometry doesn't jitter.
       */}
      <span className="relative inline-flex size-5 items-center justify-center">
        <UploadIcon
          aria-hidden
          className={cn(
            "absolute size-5 transition-[transform,opacity] duration-[var(--duration-base)] ease-[var(--ease-out)]",
            isOpen
              ? "scale-50 rotate-90 opacity-0"
              : "scale-100 rotate-0 opacity-100"
          )}
        />
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "absolute size-5 transition-[transform,opacity] duration-[var(--duration-base)] ease-[var(--ease-out)]",
            isOpen
              ? "scale-100 rotate-0 opacity-100"
              : "scale-50 -rotate-90 opacity-0"
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
            isOpen && "scale-75 opacity-0"
          )}
        >
          {activeCount}
        </span>
      ) : null}
      {children}
    </button>
  )
}
