import * as React from "react"
import type { QueryClient } from "@tanstack/react-query"
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router"

import { Toaster } from "@workspace/ui/components/sonner"

import { ClientOnly } from "@/components/app/client-only"
import { ReactivateAccountPrompt } from "@/components/account/reactivate-account-prompt"
import { redirectToSetupBeforeLoad } from "@/lib/auth-guards"
import { RuntimeConfigEvents } from "@/lib/runtime-config-events"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: redirectToSetupBeforeLoad,
  notFoundComponent: RootNotFound,
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

function RootNotFound() {
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-background p-6 text-foreground">
      <div className="flex max-w-sm flex-col gap-2 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-foreground-muted">
          The page you are looking for does not exist.
        </p>
      </div>
    </main>
  )
}
