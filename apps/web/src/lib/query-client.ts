import { QueryClient } from "@tanstack/react-query"

/**
 * QueryClient lifetime rules for TanStack Start:
 *
 *   • Server — build a fresh client per request. A shared module-level
 *     instance would leak one user's data into another's SSR render.
 *   • Browser — hold exactly one client for the life of the tab so
 *     hydration continues populating the same cache that SSR filled.
 *
 * This factory enforces both. `getQueryClient()` returns the right
 * instance for whichever environment it's called from.
 */

let browserClient: QueryClient | null = null

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 30s keeps feeds snappy without hammering the API on quick
        // navigation back-and-forth. Individual queries can override.
        staleTime: 30_000,
        // Most mutations invalidate explicitly; window-focus refetch
        // is a nice-to-have for passive freshness (e.g. someone leaves
        // the tab open, comes back ten minutes later).
        refetchOnWindowFocus: true,
        // Default 3 retries is too eager for user-visible errors —
        // fail loud after one transient retry.
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  })
}

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    // Server render — new client per request.
    return makeClient()
  }
  if (!browserClient) browserClient = makeClient()
  return browserClient
}
