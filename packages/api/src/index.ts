import { hc } from "hono/client"
import type { AppType } from "@workspace/server/app"

export type { AppType }

export type ApiClient = ReturnType<typeof hc<AppType>>

export function createApiClient(
  baseURL: string,
  init?: RequestInit
): ApiClient {
  return hc<AppType>(baseURL, {
    init: {
      credentials: "include",
      ...init,
    },
  })
}
