export interface CreateApiOptions {
  baseURL: string
  publicURL?: string
  init?: RequestInit
}

export interface ApiRequestOptions {
  method?: string
  query?: Record<string, string | undefined>
  json?: unknown
  init?: RequestInit
}

export interface ApiClient {
  request(path: string, options?: ApiRequestOptions): Promise<Response>
}

export interface ApiContext {
  baseURL: string
  publicURL: string
  client: ApiClient
  request(path: string, options?: ApiRequestOptions): Promise<Response>
}

function buildUrl(
  baseURL: string,
  path: string,
  query?: Record<string, string | undefined>
): string {
  const url = new URL(path, baseURL)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}

function mergeHeaders(
  defaults: HeadersInit | undefined,
  override: HeadersInit | undefined
): Headers {
  const headers = new Headers(defaults)
  for (const [key, value] of new Headers(override)) {
    headers.set(key, value)
  }
  return headers
}

export function createApiClient(
  baseURL: string,
  init: RequestInit = {}
): ApiClient {
  return {
    request(path, options = {}) {
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

      return fetch(buildUrl(baseURL, path, options.query), requestInit)
    },
  }
}

export function createApiContext(options: CreateApiOptions): ApiContext {
  const client = createApiClient(options.baseURL, options.init)
  return {
    baseURL: options.baseURL,
    publicURL: options.publicURL ?? options.baseURL,
    client,
    request: client.request,
  }
}
