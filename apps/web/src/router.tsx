import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"

import { getQueryClient } from "./lib/query-client"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  // One client per router instance: on the server that's per request
  // (TanStack Start calls `getRouter()` for each SSR pass), on the
  // browser that's once for the tab (see `getQueryClient`).
  const queryClient = getQueryClient()

  const router = createTanStackRouter({
    routeTree,

    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,

    // `Wrap` hosts the provider so every route (and every SSR pass)
    // sees the same QueryClient. Keeping it at the router level rather
    // than inside `__root.tsx` means route loaders can also reach the
    // client via context if we add loader-driven prefetch later.
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
