import * as React from "react"

import { toast } from "@workspace/ui/lib/toast"

import { consumeCurrentQueryParam } from "@/lib/browser-url"

const OAUTH_ERROR_QUERY_KEY = "oauth_error"

export function OAuthErrorToast() {
  React.useEffect(() => {
    const message = consumeCurrentQueryParam(OAUTH_ERROR_QUERY_KEY)
    if (!message) return

    toast.error(message)
  }, [])

  return null
}
