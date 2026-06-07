import { Link } from "@tanstack/react-router"
import type {
  ErrorComponentProps,
  NotFoundRouteProps,
} from "@tanstack/react-router"
import { AlloyLogoMark } from "alloy-ui/components/alloy-logo"
import { Button } from "alloy-ui/components/button"
import { buttonVariants } from "alloy-ui/lib/button-variants"
import { messageFromUnknown } from "alloy-ui/lib/error-message"
import { cn } from "alloy-ui/lib/utils"
import { AlertTriangle, ArrowLeft, Home, RotateCw } from "lucide-react"
import * as React from "react"

import {
  canGoBackInBrowserHistory,
  goBackInBrowserHistory,
} from "@/lib/browser-url"

type RouteStateVariant = "screen" | "panel"

type RouteErrorStateProps = ErrorComponentProps & {
  variant?: RouteStateVariant
}

type RouteNotFoundStateProps = NotFoundRouteProps & {
  variant?: RouteStateVariant
}

const isDev = import.meta.env.DEV

function RouteErrorState({
  error,
  info,
  reset,
  variant = "screen",
}: RouteErrorStateProps): React.ReactElement {
  const [showDetails, setShowDetails] = React.useState(false)
  const details = getErrorDetails(error, info)

  return (
    <RouteStateFrame variant={variant}>
      <div className="flex flex-col items-center gap-4 text-center text-balance">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-foreground flex items-center justify-center gap-2 text-lg font-semibold tracking-tight">
            <AlertTriangle className="text-danger size-4" aria-hidden />
            Something went wrong
          </h1>
          <p className="text-foreground-muted text-sm leading-relaxed">
            This view failed to load. You can retry it or return home.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" onClick={reset}>
            <RotateCw className="size-3.5" aria-hidden />
            Try again
          </Button>
          <Link to="/" className={buttonVariants({ variant: "ghost" })}>
            <Home className="size-3.5" aria-hidden />
            Go home
          </Link>
        </div>

        {isDev && details ? (
          <div className="w-full max-w-sm pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((value) => !value)}
            >
              {showDetails ? "Hide details" : "Show details"}
            </Button>
            {showDetails ? (
              <pre className="border-border text-foreground-dim mt-2 max-h-56 overflow-auto rounded-lg border border-dashed p-3 text-left font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {details}
              </pre>
            ) : null}
          </div>
        ) : null}
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
      <div className="flex flex-col items-center gap-4 text-center text-balance">
        <AlloyLogoMark size={40} />

        <div className="flex flex-col gap-1.5">
          <h1 className="text-foreground text-lg font-semibold tracking-tight">
            Page not found
          </h1>
          <p className="text-foreground-muted text-sm leading-relaxed">
            The page may have moved, been deleted, or never existed.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
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
