import { hc } from "hono/client"
import type { AppType } from "@workspace/server/app"

export type { AppType }

export type ApiClient = ReturnType<typeof hc<AppType>>

/**
 * Build a typed Hono RPC client pointing at the API server.
 *
 * `credentials: "include"` is forced so better-auth's cookie-based session
 * travels on every request without the consumer having to remember it.
 */
export function createApiClient(baseURL: string, init?: RequestInit): ApiClient {
  return hc<AppType>(baseURL, {
    init: {
      credentials: "include",
      ...init,
    },
  })
}
