import type { AppType } from "@workspace/server/app"
import { hc } from "hono/client"

export type { AppType }

export type ApiClient = ReturnType<typeof hc<AppType>>

export interface CreateApiOptions {
  baseURL: string
  publicURL?: string
  init?: RequestInit
}

export interface ApiContext {
  baseURL: string
  publicURL: string
  client: ApiClient
}

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

export function createApiContext(options: CreateApiOptions): ApiContext {
  return {
    baseURL: options.baseURL,
    publicURL: options.publicURL ?? options.baseURL,
    client: createApiClient(options.baseURL, options.init),
  }
}
