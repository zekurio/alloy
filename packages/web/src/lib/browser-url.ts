import { getRuntimeConfig } from "./runtime-env"

export function consumeCurrentQueryParam(key: string): string | null {
  if (!globalThis.window) return null

  const url = currentPublicUrl()
  const value = url.searchParams.get(key)
  if (value === null) return null

  url.searchParams.delete(key)
  const runtime = getRuntimeConfig()
  if (runtime) {
    const route = `${url.pathname}${url.search}${url.hash}`
    const outer = new URL(window.location.href)
    outer.hash = route
    window.history.replaceState(null, "", outer.toString())
  } else {
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    )
  }
  return value
}

export function canGoBackInBrowserHistory(): boolean {
  return Boolean(globalThis.window && window.history.length > 1)
}

export function goBackInBrowserHistory(): boolean {
  if (!canGoBackInBrowserHistory()) return false
  window.history.back()
  return true
}

export function currentUrlWithoutSearchOrHash(): string | null {
  if (!globalThis.window) return null

  const url = currentPublicUrl()
  url.search = ""
  url.hash = ""
  return url.toString()
}

export function currentUrlWithQueryParam(
  key: string,
  value: string,
): string | null {
  if (!globalThis.window) return null

  const url = currentPublicUrl()
  url.hash = ""
  url.searchParams.set(key, value)
  return url.toString()
}

function currentPublicUrl(): URL {
  const runtime = getRuntimeConfig()
  if (!runtime) return new URL(window.location.href)

  const route = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : ""
  return new URL(route || "/", runtime.publicOrigin)
}
