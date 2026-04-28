import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"

import {
  RouteErrorState,
  RouteNotFoundState,
} from "@/components/feedback/route-state"

import { getQueryClient } from "./lib/query-client"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = getQueryClient()

  const router = createTanStackRouter({
    routeTree,
    context: {
      queryClient,
    },

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
