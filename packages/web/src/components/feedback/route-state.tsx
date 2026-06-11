import { Link } from "@tanstack/react-router"
import type {
  ErrorComponentProps,
  NotFoundRouteProps,
} from "@tanstack/react-router"
import { Button } from "alloy-ui/components/button"
import { buttonVariants } from "alloy-ui/lib/button-variants"
import { messageFromUnknown } from "alloy-ui/lib/error-message"
import { toast } from "alloy-ui/lib/toast"
import { cn } from "alloy-ui/lib/utils"
import { ArrowLeft, Home } from "lucide-react"
import * as React from "react"

import {
  canGoBackInBrowserHistory,
  goBackInBrowserHistory,
} from "@/lib/browser-url"
import { copyTextToClipboard } from "@/lib/clipboard"

type RouteStateVariant = "screen" | "panel"

type RouteErrorStateProps = ErrorComponentProps & {
  variant?: RouteStateVariant
}

type RouteNotFoundStateProps = NotFoundRouteProps & {
  variant?: RouteStateVariant
}

function RouteErrorState({
  error,
  info,
  reset,
  variant = "screen",
}: RouteErrorStateProps): React.ReactElement {
  const message = getErrorMessage(error) ?? "This view failed to load."
  const details = getErrorDetails(error, info)
  const copyErrorDetails = React.useCallback(async () => {
    const copied = await copyTextToClipboard(details ?? message, {
      action: "copy route error details",
    })
    if (copied) {
      toast.success("Error details copied")
    } else {
      toast.error("Couldn't copy error details")
    }
  }, [details, message])

  return (
    <RouteStateFrame variant={variant}>
      <div className="flex w-full max-w-md flex-col items-start gap-4 text-left">
        <div className="flex w-full flex-col gap-2">
          <h1 className="text-foreground text-lg font-semibold tracking-tight">
            Something went wrong
          </h1>
          <pre className="border-border bg-surface-raised text-foreground-muted max-h-32 overflow-auto rounded-lg border px-3 py-2 text-left font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {message}
          </pre>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={reset}>
            Retry
          </Button>
          <Button type="button" variant="outline" onClick={copyErrorDetails}>
            Copy error
          </Button>
        </div>
      </div>
    </RouteStateFrame>
  )
}

function RouteNotFoundState({
  variant = "screen",
}: RouteNotFoundStateProps): React.ReactElement {
  const canGoBack = canGoBackInBrowserHistory()

  return (
    <RouteStateFrame variant={variant}>
      <div className="flex w-full max-w-md flex-col items-start gap-4 text-left text-balance">
        <div className="flex w-full flex-col gap-1.5">
          <h1 className="text-foreground text-lg font-semibold tracking-tight">
            Page not found
          </h1>
          <p className="text-foreground-muted text-sm leading-relaxed">
            The page may have moved, been deleted, or never existed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/" className={buttonVariants({ variant: "outline" })}>
            <Home className="size-3.5" aria-hidden />
            Go home
          </Link>
          {canGoBack ? (
            <Button
              type="button"
              variant="ghost"
              onClick={goBackInBrowserHistory}
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Go back
            </Button>
          ) : null}
        </div>
      </div>
    </RouteStateFrame>
  )
}

function RouteStateFrame({
  children,
  variant,
}: {
  children: React.ReactNode
  variant: RouteStateVariant
}) {
  const Component = variant === "screen" ? "main" : "div"

  return (
    <Component
      className={cn(
        "flex w-full items-center justify-center bg-background text-foreground",
        variant === "screen" ? "min-h-[100svh] p-6" : "min-h-full py-16",
      )}
    >
      {children}
    </Component>
  )
}

function getErrorDetails(
  error: unknown,
  info?: { componentStack: string },
): string | null {
  const message = getErrorMessage(error)
  const stack = error instanceof Error ? error.stack : null
  const componentStack = info?.componentStack
  const parts = [
    message ? `Message:\n${message}` : null,
    stack ? `Stack:\n${stack}` : null,
    componentStack ? `Component stack:\n${componentStack}` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join("\n\n") : null
}

function getErrorMessage(error: unknown): string | null {
  return (
    messageFromUnknown(error) ?? (error instanceof Error ? error.name : null)
  )
}

export { RouteErrorState, RouteNotFoundState }
