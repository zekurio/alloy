import * as React from "react"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, ArrowLeft, Home, RotateCw } from "lucide-react"
import type {
  ErrorComponentProps,
  NotFoundRouteProps,
} from "@tanstack/react-router"

import { AlloyLogoMark } from "@workspace/ui/components/alloy-logo"
import { Button } from "@workspace/ui/components/button"
import { buttonVariants } from "@workspace/ui/lib/button-variants"
import { cn } from "@workspace/ui/lib/utils"

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
      <RouteStateSurface>
        <RouteStateHeader
          eyebrow="Route error"
          icon={
            <span className="flex size-8 items-center justify-center rounded-md border border-[color-mix(in_oklab,var(--danger)_45%,transparent)] bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-danger">
              <AlertTriangle className="size-4" aria-hidden />
            </span>
          }
          title="Something went wrong"
          description="This view failed to load. You can retry it or return home."
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={reset}>
            <RotateCw className="size-3.5" aria-hidden />
            Try again
          </Button>
          <Link to="/" className={buttonVariants({ variant: "secondary" })}>
            <Home className="size-3.5" aria-hidden />
            Go home
          </Link>
        </div>

        {isDev && details ? (
          <div className="w-full border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((value) => !value)}
            >
              {showDetails ? "Hide details" : "Show details"}
            </Button>
            {showDetails ? (
              <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-border bg-surface-raised p-3 text-left font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground-muted">
                {details}
              </pre>
            ) : null}
          </div>
        ) : null}
      </RouteStateSurface>
    </RouteStateFrame>
  )
}

function RouteNotFoundState({
  variant = "screen",
}: RouteNotFoundStateProps): React.ReactElement {
  const canGoBack =
    typeof window !== "undefined" && window.history.length > 1

  return (
    <RouteStateFrame variant={variant}>
      <RouteStateSurface>
        <RouteStateHeader
          eyebrow="404"
          icon={<AlloyLogoMark size={32} />}
          title="Page not found"
          description="The page may have moved, been deleted, or never existed."
        />

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/" className={buttonVariants()}>
            <Home className="size-3.5" aria-hidden />
            Go home
          </Link>
          {canGoBack ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Go back
            </Button>
          ) : null}
        </div>
      </RouteStateSurface>
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
        variant === "screen" ? "min-h-[100svh] p-6" : "min-h-full py-16"
      )}
    >
      {children}
    </Component>
  )
}

function RouteStateSurface({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex w-full max-w-[420px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-sm">
      {children}
    </section>
  )
}

function RouteStateHeader({
  description,
  eyebrow,
  icon,
  title,
}: {
  description: string
  eyebrow: string
  icon: React.ReactNode
  title: string
}) {
  return (
    <div className="flex flex-col gap-3">
      {icon}
      <div className="flex flex-col gap-1.5">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="text-lg font-semibold tracking-normal text-foreground">
          {title}
        </h1>
        <p className="text-sm leading-relaxed text-foreground-muted">
          {description}
        </p>
      </div>
    </div>
  )
}

function getErrorDetails(
  error: unknown,
  info?: { componentStack: string }
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
  if (error instanceof Error) {
    return error.message || error.name
  }
  if (typeof error === "string") {
    return error
  }
  return null
}

export { RouteErrorState, RouteNotFoundState }
export type { RouteErrorStateProps, RouteNotFoundStateProps }
