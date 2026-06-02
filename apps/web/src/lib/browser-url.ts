export function consumeCurrentQueryParam(key: string): string | null {
  if (typeof window === "undefined") return null

  const url = new URL(window.location.href)
  const value = url.searchParams.get(key)
  if (value === null) return null

  url.searchParams.delete(key)
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  )
  return value
}

export function canGoBackInBrowserHistory(): boolean {
  return typeof window !== "undefined" && window.history.length > 1
}

export function goBackInBrowserHistory(): boolean {
  if (!canGoBackInBrowserHistory()) return false
  window.history.back()
  return true
}

export function currentUrlWithoutSearchOrHash(): string | null {
  if (typeof window === "undefined") return null

  const url = new URL(window.location.href)
  url.search = ""
  url.hash = ""
  return url.toString()
}

export function currentUrlWithQueryParam(
  key: string,
  value: string,
): string | null {
  if (typeof window === "undefined") return null

  const url = new URL(window.location.href)
  url.hash = ""
  url.searchParams.set(key, value)
  return url.toString()
}
