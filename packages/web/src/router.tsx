import { QueryClientProvider } from "@tanstack/react-query"
import { createHashHistory, createRouter } from "@tanstack/react-router"

import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"

import { getQueryClient } from "./lib/query-client"
import { isDesktopRuntime } from "./lib/runtime-env"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = getQueryClient()

  const router = createRouter({
    routeTree,
    context: {
      queryClient,
    },
    // The bundled renderer has no server-side route fallback. Main-process
    // commands place both the route and its search parameters after `#`.
    history: isDesktopRuntime() ? createHashHistory() : undefined,

    scrollRestoration: true,
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

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
