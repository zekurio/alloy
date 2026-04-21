import { QueryClient } from "@tanstack/react-query"

let browserClient: QueryClient | null = null

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 30s keeps feeds snappy without hammering the API on quick
        // navigation back-and-forth. Individual queries can override.
        staleTime: 30_000,
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
