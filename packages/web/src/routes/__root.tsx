import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import { Suspense, lazy, useEffect } from "react"

import { OAuthErrorToast } from "@/components/auth/oauth-error-toast"
import { redirectToSetupBeforeLoad } from "@/lib/auth-guards"
import { alloyWindowChrome } from "@/lib/desktop"
import { ThemeAccountSync } from "@/lib/theme-account-sync"

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: redirectToSetupBeforeLoad,
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
  // In the desktop shell with custom chrome, flag the document so the app
  // header becomes a draggable title bar (see globals.css).
  useEffect(() => {
    if (!alloyWindowChrome()) return
    const root = document.documentElement
    root.classList.add("is-desktop-titlebar")
    return () => root.classList.remove("is-desktop-titlebar")
  }, [])

  return (
    <>
      <Outlet />
      <ThemeAccountSync />
      <Suspense fallback={null}>
        <OAuthErrorToast />
        <ReactivateAccountPrompt />
      </Suspense>
      {/* Global toast portal — rendered once at the root so every route
          can call `toast.*` without mounting its own provider. */}
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </>
  )
}
