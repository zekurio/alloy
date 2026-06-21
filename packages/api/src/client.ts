import type { AppType } from "@alloy/server/app"
import { type ClientRequestOptions, hc } from "hono/client"

import { AUTH_PATHS } from "./auth-paths"
import { queryParams, type QueryParamValue } from "./paths"

export interface CreateApiOptions {
  baseURL: string
  publicURL?: string
  init?: RequestInit
}

export interface ApiRequestOptions {
  method?: string
  query?: Record<string, QueryParamValue>
  json?: unknown
  init?: RequestInit
}

export interface ApiClient {
  request(path: string, options?: ApiRequestOptions): Promise<Response>
}

export type RpcClient = ReturnType<typeof hc<AppType>>

export interface ApiContext {
  baseURL: string
  publicURL: string
  client: ApiClient
  rpc: RpcClient
  request(path: string, options?: ApiRequestOptions): Promise<Response>
}

function buildUrl(
  baseURL: string,
  path: string,
  query?: Record<string, QueryParamValue>,
): string {
  const url = new URL(path, baseURL)
  for (const [key, value] of Object.entries(queryParams(query ?? {}))) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function mergeHeaders(
  defaults: HeadersInit | undefined,
  override: HeadersInit | undefined,
): Headers {
  const headers = new Headers(defaults)
  for (const [key, value] of new Headers(override)) {
    headers.set(key, value)
  }
  return headers
}

export function createApiClient(
  baseURL: string,
  init: RequestInit = {},
  fetcher: typeof fetch = createSessionRefreshingFetch(baseURL, init),
): ApiClient {
  return {
    async request(path, options = {}) {
      const headers = mergeHeaders(init.headers, options.init?.headers)
      const requestInit: RequestInit = {
        ...init,
        ...options.init,
        method: options.method ?? options.init?.method ?? "GET",
        credentials: options.init?.credentials ?? init.credentials ?? "include",
        headers,
      }

      if (options.json !== undefined) {
        headers.set("Content-Type", "application/json")
        requestInit.body = JSON.stringify(options.json)
      }

      return fetcher(buildUrl(baseURL, path, options.query), requestInit)
    },
  }
}

function createSessionRefreshingFetch(
  baseURL: string,
  init: RequestInit = {},
): typeof fetch {
  let refreshPromise: Promise<boolean> | null = null

  async function refreshAuthSession(): Promise<boolean> {
    if (!refreshPromise) {
      refreshPromise = fetch(buildUrl(baseURL, AUTH_PATHS.refresh), {
        method: "POST",
        credentials: init.credentials ?? "include",
        headers: mergeHeaders(init.headers, undefined),
      })
        .then((res) => res.ok)
        .catch(() => false)
        .finally(() => {
          refreshPromise = null
        })
    }
    return refreshPromise
  }

  return async (input, requestInit) => {
    const res = await fetch(input, requestInit)
    if (res.status !== 401 || isAuthRefreshBypass(baseURL, input)) return res

    if (!(await refreshAuthSession())) return res
    return fetch(input, requestInit)
  }
}

function isAuthRefreshBypass(
  baseURL: string,
  input: RequestInfo | URL,
): boolean {
  const url =
    typeof input === "string" || input instanceof URL
      ? new URL(input, baseURL)
      : new URL(input.url, baseURL)
  return (
    url.pathname === AUTH_PATHS.refresh || url.pathname === AUTH_PATHS.signOut
  )
}

function createRpcClient(
  baseURL: string,
  init: RequestInit = {},
  fetcher: typeof fetch = createSessionRefreshingFetch(baseURL, init),
): RpcClient {
  const options: ClientRequestOptions = {
    fetch: fetcher,
    init: {
      ...init,
      credentials: init.credentials ?? "include",
    },
  }
  return hc<AppType>(baseURL, options)
}

export function createApiContext(options: CreateApiOptions): ApiContext {
  const init = options.init ?? {}
  const fetcher = createSessionRefreshingFetch(options.baseURL, init)
  const client = createApiClient(options.baseURL, init, fetcher)
  return {
    baseURL: options.baseURL,
    publicURL: options.publicURL ?? options.baseURL,
    client,
    rpc: createRpcClient(options.baseURL, init, fetcher),
    request: client.request,
  }
}
