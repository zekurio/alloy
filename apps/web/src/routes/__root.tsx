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
  import("@workspace/ui/components/sonner").then((m) => ({
    default: m.Toaster,
  })),
)

function RootLayout() {
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
