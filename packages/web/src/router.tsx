import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"

import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"

import { getQueryClient, resetClientState } from "./lib/query-client"
import { setSessionEndedHandler } from "./lib/session-recheck"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = getQueryClient()

  const router = createRouter({
    routeTree,
    context: {
      queryClient,
    },
    scrollRestoration: true,
    // In the desktop's rounded frame the page scrolls inside #root rather
    // than the document (see `.is-desktop-rounded` in globals.css), so
    // navigation resets that element too. A no-op where the document scrolls.
    scrollToTopSelectors: ["#root"],
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
    defaultErrorComponent: (props) => (
      <RouteErrorState {...props} variant="screen" />
    ),
    defaultNotFoundComponent: (props) => (
      <RouteNotFoundState {...props} variant="screen" />
    ),

    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })

  // Once the server drops the session, clear signed-in caches and rerun the
  // route guards. Protected routes then redirect to a bare /login, which the
  // desktop app shows as its sign-in screen.
  setSessionEndedHandler(async () => {
    resetClientState()
    await router.invalidate()
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
  interface HistoryState {
    /** The entry below this one is the settings overview that opened it. */
    settingsFromOverview?: boolean
  }
}
