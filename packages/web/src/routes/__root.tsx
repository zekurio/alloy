import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import * as React from "react"

import { ClientOnly } from "@/components/app/client-only"
import { OAuthErrorToast } from "@/components/auth/oauth-error-toast"
import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"
import { redirectToSetupBeforeLoad } from "@/lib/auth-guards"
import { alloyDesktop } from "@/lib/desktop"
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

const ReactivateAccountPrompt = React.lazy(() =>
  import("@/components/account/reactivate-account-prompt").then((m) => ({
    default: m.ReactivateAccountPrompt,
  })),
)

const Toaster = React.lazy(() =>
  import("alloy-ui/components/sonner").then((m) => ({
    default: m.Toaster,
  })),
)

function RootLayout() {
  // In the desktop shell with custom chrome, flag the document so the app
  // header becomes a draggable title bar (see globals.css).
  React.useEffect(() => {
    if (!alloyDesktop()?.titlebarOverlay) return
    const root = document.documentElement
    root.classList.add("is-desktop-titlebar")
    return () => root.classList.remove("is-desktop-titlebar")
  }, [])

  return (
    <>
      <Outlet />
      <ClientOnly>
        <React.Suspense fallback={null}>
          <RuntimeConfigEvents />
          <OAuthErrorToast />
          <ReactivateAccountPrompt />
        </React.Suspense>
      </ClientOnly>
      {/* Global toast portal — rendered once at the root so every route
          can call `toast.*` without mounting its own provider. */}
      <React.Suspense fallback={null}>
        <Toaster />
      </React.Suspense>
    </>
  )
}
