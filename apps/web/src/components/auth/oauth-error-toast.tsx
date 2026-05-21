import * as React from "react"

import { toast } from "@workspace/ui/lib/toast"

const OAUTH_ERROR_QUERY_KEY = "oauth_error"

export function OAuthErrorToast() {
  React.useEffect(() => {
    const url = new URL(window.location.href)
    const message = url.searchParams.get(OAUTH_ERROR_QUERY_KEY)
    if (!message) return

    toast.error(message)
    url.searchParams.delete(OAUTH_ERROR_QUERY_KEY)
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    )
  }, [])

  return null
}
