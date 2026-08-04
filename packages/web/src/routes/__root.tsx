import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import { Suspense, lazy, useEffect } from "react"

import { ClientOnly } from "@/components/app/client-only"
import { OAuthErrorToast } from "@/components/auth/oauth-error-toast"
import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"
import { redirectToSetupBeforeLoad } from "@/lib/auth-guards"
import { alloyDesktop, desktopBridgeMismatch } from "@/lib/desktop"
import { RuntimeConfigEvents } from "@/lib/runtime-config-events"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: redirectToSetupBeforeLoad,
  errorComponent: (props) => <RouteErrorState {...props} variant="screen" />,
  notFoundComponent: (props) => (
    <RouteNotFoundState {...props} variant="screen" />
  ),
  component: RootLayout,
})

const ReactivateAccountPrompt = lazy(() =>
  import("@/components/account/reactivate-account-prompt").then((m) => ({
    default: m.ReactivateAccountPrompt,
  })),
)

const Toaster = lazy(() =>
  import("@alloy/ui/components/sonner").then((m) => ({
    default: m.Toaster,
  })),
)

function RootLayout() {
  const bridgeMismatch = desktopBridgeMismatch()
  // In the desktop shell with custom chrome, flag the document so the app
  // header becomes a draggable title bar (see globals.css).
  useEffect(() => {
    if (!alloyDesktop()?.titlebarOverlay) return
    const root = document.documentElement
    root.classList.add("is-desktop-titlebar")
    return () => root.classList.remove("is-desktop-titlebar")
  }, [])

  if (bridgeMismatch) {
    return (
      <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Desktop update required</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            This Alloy server requires desktop bridge {bridgeMismatch.expected},
            but this app provides bridge {bridgeMismatch.actual}. Update Alloy
            Desktop to continue.
          </p>
        </div>
      </main>
    )
  }

  return (
    <>
      <Outlet />
      <ClientOnly>
        <Suspense fallback={null}>
          <RuntimeConfigEvents />
          <OAuthErrorToast />
          <ReactivateAccountPrompt />
        </Suspense>
      </ClientOnly>
      {/* Global toast portal — rendered once at the root so every route
          can call `toast.*` without mounting its own provider. */}
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </>
  )
}
