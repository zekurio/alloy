import * as React from "react"
import { useLocation } from "@tanstack/react-router"

import { toast } from "@workspace/ui/lib/toast"

import { consumeCurrentQueryParam } from "@/lib/browser-url"
import { isAuthAttemptCancellation } from "@/lib/auth-flow"

const OAUTH_ERROR_QUERY_KEY = "oauth_error"

export function OAuthErrorToast() {
  const location = useLocation()

  React.useEffect(() => {
    const message = consumeCurrentQueryParam(OAUTH_ERROR_QUERY_KEY)
    if (!message) return

    if (isAuthAttemptCancellation(message)) {
      toast.warning("Auth attempt cancelled.")
      return
    }
    toast.error(message)
  }, [location.href])

  return null
}
