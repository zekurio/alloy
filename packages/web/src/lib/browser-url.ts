export function consumeCurrentQueryParam(key: string): string | null {
  const url = currentPublicUrl()
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
  return window.history.length > 1
}

export function goBackInBrowserHistory(): boolean {
  if (!canGoBackInBrowserHistory()) return false
  window.history.back()
  return true
}

export function currentUrlWithQueryParam(key: string, value: string): string {
  const url = currentPublicUrl()
  url.hash = ""
  url.searchParams.set(key, value)
  return url.toString()
}

function currentPublicUrl(): URL {
  return new URL(window.location.href)
}
