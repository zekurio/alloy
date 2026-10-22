import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps, MouseEvent } from "react"

/** Target of the shell's skip link; every main variant carries it. */
const APP_MAIN_ID = "app-main"

function AppShell({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="app-shell"
      className={cn(
        "relative grid h-dvh w-full overflow-hidden bg-background",
        "[--app-content-padding:0.75rem]",
        "[--app-popover-anchor-inset:calc(var(--app-content-padding)+5px)]",
        // Mobile: single column; navigation lives in a fixed bottom nav.
        "[grid-template-columns:1fr]",
        "[grid-template-rows:var(--header-h)_1fr]",
        "[grid-template-areas:'header''main']",
        // Desktop (md+): icon-only sidebar rail + main, header spans both.
        "md:[grid-template-columns:var(--sidebar-rail)_1fr]",
        "md:[grid-template-rows:var(--header-h)_1fr]",
        "md:[grid-template-areas:'header_header''sidebar_main']",
        "[&_[data-slot=app-sidebar]]:[grid-area:sidebar]",
        "[&_[data-slot=app-header]]:[grid-area:header]",
        "[&_[data-slot=app-main]]:[grid-area:main]",
        className,
      )}
      {...props}
    >
      <a
        href={`#${APP_MAIN_ID}`}
        onClick={skipToMain}
        className={cn(
          // Out of the grid flow either way: absolute while hidden, fixed once
          // focused, so it never claims a grid cell.
          "fixed top-2 left-2 z-[100] not-focus:sr-only",
          "rounded-md border border-border bg-popover px-3 py-2 text-sm font-medium text-popover-foreground shadow-lg",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        {t("Skip to content")}
      </a>
      {children}
      <span
        aria-hidden
        data-slot="app-bottom-left-anchor"
        className="pointer-events-none fixed bottom-[var(--app-content-padding)] left-[calc(var(--sidebar-rail)+var(--app-popover-anchor-inset))] hidden size-0 md:block"
      />
      <span
        aria-hidden
        data-slot="app-top-right-anchor"
        className="pointer-events-none fixed top-[calc(var(--header-h)+var(--app-content-padding))] right-[var(--app-popover-anchor-inset)] size-0"
      />
      <span
        aria-hidden
        data-slot="app-bottom-right-anchor"
        className="pointer-events-none fixed right-[var(--app-popover-anchor-inset)] bottom-[var(--app-content-padding)] hidden size-0 md:block"
      />
    </div>
  )
}

/**
 * Moves focus into the main region without following the fragment, which would
 * add a history entry the router treats as a navigation. `<main>` is not
 * focusable, so it takes a temporary tabindex that it drops again on blur.
 */
function skipToMain(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault()
  const main = document.getElementById(APP_MAIN_ID)
  if (!main) return
  if (!main.hasAttribute("tabindex")) {
    main.setAttribute("tabindex", "-1")
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), {
      once: true,
    })
  }
  main.focus()
}

const scrollRegionClass = cn(
  "overflow-x-hidden overflow-y-auto p-[var(--app-content-padding)]",
  // Clear the fixed mobile bottom-nav (hidden on md+) so the last row of
  // content isn't trapped behind it.
  "max-md:pb-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+var(--app-content-padding))]",
)

/**
 * Main content region. It scrolls vertically and uses the shared 12px shell
 * inset on every side.
 */
function AppMain({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      id={APP_MAIN_ID}
      data-slot="app-main"
      className={cn(scrollRegionClass, className)}
      {...props}
    />
  )
}

/**
 * AppMain variant for pages that pin a toolbar above the scrolling region:
 * a non-scrolling column filling the main grid area. Render a pinned row
 * (e.g. `PageToolbar pinned`) followed by `AppMainScroll`. Pinning by
 * structure avoids `position: sticky` inside a scroll container, which is
 * unreliable in mobile WebKit.
 */
function AppMainColumn({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      id={APP_MAIN_ID}
      data-slot="app-main"
      className={cn("flex min-h-0 flex-col overflow-hidden", className)}
      {...props}
    />
  )
}

/** Scrolling content region of `AppMainColumn`; carries AppMain's padding. */
function AppMainScroll({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="app-main-scroll"
      className={cn("min-h-0 flex-1", scrollRegionClass, className)}
      {...props}
    />
  )
}

export { AppMain, AppMainColumn, AppMainScroll, AppShell }
