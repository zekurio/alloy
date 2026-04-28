import * as React from "react"
import type { QueryClient } from "@tanstack/react-query"
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router"

import { Toaster } from "@workspace/ui/components/sonner"

import { ClientOnly } from "@/components/app/client-only"
import { ReactivateAccountPrompt } from "@/components/account/reactivate-account-prompt"
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

function RootLayout() {
  return (
    <>
      <Outlet />
      <ClientOnly>
        <React.Suspense fallback={null}>
          <RuntimeConfigEvents />
          <ReactivateAccountPrompt />
        </React.Suspense>
      </ClientOnly>
      {/* Global toast portal — rendered once at the root so every route
          can call `toast.*` without mounting its own provider. */}
      <Toaster />
    </>
  )
}
